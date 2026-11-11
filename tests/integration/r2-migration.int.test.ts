// R2 paso 1: la MIGRACIÓN en sí, probada de punta a punta contra Postgres real.
// Se ejecuta en un schema aislado ("mig_r2") de la BD de pruebas, así no toca las tablas de "public"
// que usan las demás pruebas:
//   init -> r1 -> [datos "legados"] -> r2 (up) -> down -> r2 (up de nuevo)
// y comprueba datos, estructura (columnas, restricciones, índices, enums) y el relleno de códigos.
import fs from "node:fs";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./helpers";

const SCHEMA = "mig_r2";
const MIG_DIR = path.resolve(process.cwd(), "prisma/migrations");
const R2 = "20261111120000_r2_auth_schema_autoria";
const TIMEOUT = 240_000;

const sqlOf = (dir: string, file = "migration.sql") => fs.readFileSync(path.join(MIG_DIR, dir, file), "utf8");

/** Parte un script en sentencias respetando comentarios, comillas simples y bloques $$ ... $$. */
function splitSql(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inDollar = false;
  for (let i = 0; i < sql.length; i++) {
    const two = sql.slice(i, i + 2);
    if (!inDollar && two === "--") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl - 1;
      continue;
    }
    if (two === "$$") {
      inDollar = !inDollar;
      cur += "$$";
      i++;
      continue;
    }
    const ch = sql[i];
    if (ch === "'" && !inDollar) {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      cur += sql.slice(i, j + 1);
      i = j;
      continue;
    }
    if (ch === ";" && !inDollar) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

type Tx = Prisma.TransactionClient;

/**
 * Ejecuta `fn` en una transacción con search_path = schema aislado. El SQL crudo de Prisma NO respeta
 * el parámetro ?schema= de la URL, así que se fija explícitamente en cada transacción (SET LOCAL).
 */
async function inSchema<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      return fn(tx);
    },
    { timeout: 120_000, maxWait: 30_000 }
  );
}

/** Ejecuta un script completo en UNA transacción (igual que lo hace `migrate deploy`). */
async function run(sql: string) {
  const stmts = splitSql(sql);
  await inSchema(async (tx) => {
    for (const s of stmts) await tx.$executeRawUnsafe(s);
  });
}

const exec = (sql: string) => inSchema((tx) => tx.$executeRawUnsafe(sql));

async function rows<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  return inSchema(async (tx) => (await tx.$queryRawUnsafe(sql)) as T[]);
}

/** Estructura completa del schema (sin nombres de schema para poder comparar con "public"). */
async function structure(db: { $queryRawUnsafe: Tx["$queryRawUnsafe"] }, schema: string) {
  const strip = (s: string) => s.replace(new RegExp(`"?${schema}"?\\.`, "g"), "");
  const q = async (sql: string) => (await db.$queryRawUnsafe(sql)) as Record<string, string>[];
  const columns = (
    await q(`SELECT table_name||'.'||column_name||' '||data_type||' null='||is_nullable||' def='||coalesce(column_default,'-') AS v
             FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name <> '_prisma_migrations' ORDER BY 1`)
  ).map((r) => strip(r.v));
  const constraints = (
    await q(`SELECT conrelid::regclass::text||' '||conname||' '||pg_get_constraintdef(oid)||' valid='||convalidated::text AS v
             FROM pg_constraint WHERE connamespace = '${schema}'::regnamespace AND conrelid::regclass::text NOT LIKE '%_prisma_migrations%' ORDER BY 1`)
  ).map((r) => strip(r.v));
  const indexes = (
    await q(`SELECT tablename||' '||indexname||' '||indexdef AS v FROM pg_indexes WHERE schemaname = '${schema}' AND tablename <> '_prisma_migrations' ORDER BY 1`)
  ).map((r) => strip(r.v));
  const enums = (
    await q(`SELECT t.typname||' '||string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS v
             FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typnamespace = '${schema}'::regnamespace GROUP BY t.typname ORDER BY 1`)
  ).map((r) => r.v);
  return { columns, constraints, indexes, enums };
}

const TABLES = ["Store", "User", "Customer", "Product", "Sale", "Payment", "StockEntry"];

/** Conteos por tabla + huellas del contenido relevante (sin imprimir datos). */
async function fingerprint(authorCol: "userId" | "createdByUserId") {
  const counts: Record<string, number> = {};
  for (const t of TABLES) counts[t] = Number((await rows<{ n: bigint }>(`SELECT count(*)::int AS n FROM "${t}"`))[0].n);
  const h = async (sql: string) => (await rows<{ h: string }>(sql))[0].h;
  return {
    counts,
    users: await h(`SELECT md5(string_agg(id||'|'||"storeId"||'|'||phone||'|'||"pinHash"||'|'||role::text, ',' ORDER BY id)) AS h FROM "User"`),
    saleAuthors: await h(`SELECT md5(string_agg(id||'|'||coalesce("${authorCol}",'-')||'|'||total::text||'|'||coalesce("voidedAt"::text,'-'), ',' ORDER BY id)) AS h FROM "Sale"`),
    paymentAuthors: await h(`SELECT md5(string_agg(id||'|'||coalesce("${authorCol}",'-')||'|'||amount::text||'|'||coalesce("voidedAt"::text,'-'), ',' ORDER BY id)) AS h FROM "Payment"`),
    stockVoids: await h(`SELECT md5(string_agg(id||'|'||coalesce("voidedAt"::text,'-'), ',' ORDER BY id)) AS h FROM "StockEntry"`),
  };
}

const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/;
async function storeCodes() {
  return (await rows<{ code: string }>(`SELECT "code" FROM "Store" ORDER BY id`)).map((r) => r.code);
}

let before: Awaited<ReturnType<typeof fingerprint>>;
let structureR1: Awaited<ReturnType<typeof structure>>;
let structureR2: Awaited<ReturnType<typeof structure>>;

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);

  // Guardia: todo lo que sigue corre en el schema aislado, jamás en "public".
  const sp = await rows<{ search_path: string }>(`SHOW search_path`);
  expect(sp[0].search_path).toBe(SCHEMA);

  // Estado anterior a R2: migraciones init y r1 en orden.
  await run(sqlOf("20260702045931_init"));
  await run(sqlOf("20261110120000_r1_aislamiento_tienda"));
  await exec(`CREATE TABLE "_prisma_migrations" (migration_name text)`);
  await exec(`INSERT INTO "_prisma_migrations"(migration_name) VALUES ('${R2}')`);

  // Datos "legados": tres tiendas con dueño; ventas/abonos con autor, sin autor, y anulados.
  const seed = [
    `INSERT INTO "Store"(id,name,phone,"updatedAt") VALUES ('s1','Tienda 1','3000000001',now()),('s2','Tienda 2','3000000002',now()),('s3','Tienda 3','3000000003',now())`,
    `INSERT INTO "User"(id,"storeId",name,phone,"pinHash","updatedAt") VALUES ('u1','s1','Dueño 1','3100000001','hash1',now()),('u2','s2','Dueño 2','3100000002','hash2',now()),('u3','s3','Dueño 3','3100000003','hash3',now())`,
    `INSERT INTO "Customer"(id,"storeId",name,"updatedAt") VALUES ('c1','s1','Cliente',now())`,
    `INSERT INTO "Product"(id,"storeId",name,"salePrice","updatedAt") VALUES ('p1','s1','Prod',1000,now())`,
    `INSERT INTO "Sale"(id,"storeId","paymentType",total,"userId","voidedAt") VALUES
       ('sa1','s1','CASH',1000,'u1',NULL),
       ('sa2','s1','CASH',2000,NULL,NULL),
       ('sa3','s1','CASH',3000,'u1',now()),
       ('sb1','s2','CASH',4000,'u2',NULL)`,
    `INSERT INTO "Payment"(id,"storeId","customerId",amount,"userId","voidedAt") VALUES
       ('pa1','s1','c1',500,'u1',NULL),
       ('pa2','s1','c1',600,NULL,NULL),
       ('pa3','s1','c1',700,'u1',now())`,
    `INSERT INTO "StockEntry"(id,"storeId","productId",quantity,"totalCost","unitCost","voidedAt") VALUES ('se1','s1','p1',1,100,100,now())`,
  ];
  for (const s of seed) await exec(s);

  before = await fingerprint("userId");
  structureR1 = await inSchema((tx) => structure(tx, SCHEMA));
}, TIMEOUT);

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
}, TIMEOUT);

describe("R2: up sobre datos existentes", () => {
  it(
    "aplica sin perder ni cambiar datos; los usuarios existentes siguen siendo OWNER con tokenVersion 0",
    async () => {
      await run(sqlOf(R2));

      const after = await fingerprint("createdByUserId");
      expect(after.counts).toEqual(before.counts);
      expect(after.users).toBe(before.users); // id, tienda, celular, hash del PIN y rol, intactos
      expect(after.saleAuthors).toBe(before.saleAuthors); // el autor de cada venta sigue igual (RENAME, no drop+add)
      expect(after.paymentAuthors).toBe(before.paymentAuthors);
      expect(after.stockVoids).toBe(before.stockVoids);

      const users = await rows<{ role: string; tokenVersion: number; pinHashVersion: number; isActive: boolean; mustChangePin: boolean }>(
        `SELECT role::text AS role, "tokenVersion", "pinHashVersion", "isActive", "mustChangePin" FROM "User"`
      );
      expect(users).toHaveLength(3);
      for (const u of users) {
        expect(u).toEqual({ role: "OWNER", tokenVersion: 0, pinHashVersion: 1, isActive: true, mustChangePin: false });
      }
    },
    TIMEOUT
  );

  it(
    "los NULL históricos de autoría quedan en NULL y las anulaciones antiguas no inventan quién anuló",
    async () => {
      const q = async (sql: string) => Number((await rows<{ n: number }>(sql))[0].n);
      expect(await q(`SELECT count(*)::int AS n FROM "Sale" WHERE "createdByUserId" IS NULL`)).toBe(1); // sa2
      expect(await q(`SELECT count(*)::int AS n FROM "Payment" WHERE "createdByUserId" IS NULL`)).toBe(1); // pa2
      expect(await q(`SELECT count(*)::int AS n FROM "Sale" WHERE "voidedAt" IS NOT NULL AND "voidedByUserId" IS NULL`)).toBe(1);
      expect(await q(`SELECT count(*)::int AS n FROM "Payment" WHERE "voidedAt" IS NOT NULL AND "voidedByUserId" IS NULL`)).toBe(1);
      expect(await q(`SELECT count(*)::int AS n FROM "StockEntry" WHERE "voidedAt" IS NOT NULL AND "voidedByUserId" IS NULL`)).toBe(1);
      expect(await q(`SELECT count(*)::int AS n FROM "Sale" WHERE "createdByUserId" = 'u1'`)).toBe(2); // sa1, sa3
    },
    TIMEOUT
  );

  it(
    "relleno de códigos: 6 caracteres válidos, sin ambiguos y únicos para las tiendas existentes",
    async () => {
      const codes = await storeCodes();
      expect(codes).toHaveLength(3);
      for (const c of codes) expect(c).toMatch(CODE_RE);
      expect(new Set(codes).size).toBe(3);
      for (const c of codes) for (const bad of "01OILU") expect(c).not.toContain(bad);
    },
    TIMEOUT
  );

  it(
    "el relleno es idempotente: repetirlo no cambia códigos ya asignados y solo completa los NULL",
    async () => {
      const original = await storeCodes();
      const block = splitSql(sqlOf(R2)).find((s) => s.includes("alphabet CONSTANT"));
      expect(block).toBeDefined();

      // 1) Repetirlo con todo ya asignado: nada cambia.
      await exec(block!);
      expect(await storeCodes()).toEqual(original);

      // 2) Dejar un código en NULL: solo ese se completa, y queda válido y distinto de los demás.
      await exec(`ALTER TABLE "Store" ALTER COLUMN "code" DROP NOT NULL`);
      await exec(`UPDATE "Store" SET "code" = NULL WHERE id = 's2'`);
      await exec(block!);
      const after = await storeCodes();
      expect(after[0]).toBe(original[0]);
      expect(after[2]).toBe(original[2]);
      expect(after[1]).toMatch(CODE_RE);
      expect(new Set(after).size).toBe(3);
      await exec(`ALTER TABLE "Store" ALTER COLUMN "code" SET NOT NULL`);
    },
    TIMEOUT
  );

  it(
    "las filas nuevas sí exigen autor y anulación completa (CHECK NOT VALID); el histórico no se revalida",
    async () => {
      const bad = (sql: string) => exec(sql);
      await expect(bad(`INSERT INTO "Sale"(id,"storeId","paymentType",total) VALUES ('n1','s1','CASH',100)`)).rejects.toThrow(/Sale_created_by_required_chk/);
      await expect(
        bad(`INSERT INTO "Payment"(id,"storeId","customerId",amount) VALUES ('n2','s1','c1',100)`)
      ).rejects.toThrow(/Payment_created_by_required_chk/);
      await expect(
        bad(`INSERT INTO "Sale"(id,"storeId","paymentType",total,"createdByUserId","voidedAt") VALUES ('n3','s1','CASH',100,'u1',now())`)
      ).rejects.toThrow(/Sale_void_pair_chk/);
      await bad(`INSERT INTO "Sale"(id,"storeId","paymentType",total,"createdByUserId") VALUES ('n4','s1','CASH',100,'u1')`);
      await bad(`DELETE FROM "Sale" WHERE id = 'n4'`);

      // Las restricciones quedaron NOT VALID (convalidated = false) y por eso no revisan el histórico.
      const notValid = await rows<{ conname: string }>(
        `SELECT conname FROM pg_constraint WHERE connamespace = '${SCHEMA}'::regnamespace AND NOT convalidated ORDER BY 1`
      );
      expect(notValid.map((r) => r.conname)).toEqual([
        "Payment_created_by_required_chk",
        "Payment_void_pair_chk",
        "Sale_created_by_required_chk",
        "Sale_void_pair_chk",
        "StockEntry_void_pair_chk",
      ]);
    },
    TIMEOUT
  );

  it(
    "estructura tras el up == estructura real de la BD de pruebas migrada con `migrate deploy` (public)",
    async () => {
      structureR2 = await inSchema((tx) => structure(tx, SCHEMA));
      const real = await structure(prisma, "public");
      // Guardia contra una igualdad vacía: la estructura debe traer tablas, restricciones e índices reales.
      expect(structureR2.columns.length).toBeGreaterThan(100);
      expect(structureR2.constraints.length).toBeGreaterThan(60);
      expect(structureR2.indexes.length).toBeGreaterThan(40);
      expect(structureR2.enums.some((e) => e.startsWith("AuthEventType "))).toBe(true);
      expect(structureR2.enums.length).toBeGreaterThanOrEqual(4);
      expect(structureR2).toEqual(real);
    },
    TIMEOUT
  );
});

describe("R2: down y up de nuevo", () => {
  it(
    "down deja EXACTAMENTE la estructura anterior (R1) y conserva los datos y la autoría (userId)",
    async () => {
      await run(sqlOf(R2, "down.sql"));

      expect(await inSchema((tx) => structure(tx, SCHEMA))).toEqual(structureR1);
      const after = await fingerprint("userId");
      expect(after.counts).toEqual(before.counts);
      expect(after.users).toBe(before.users);
      expect(after.saleAuthors).toBe(before.saleAuthors);
      expect(after.paymentAuthors).toBe(before.paymentAuthors);
      expect(after.stockVoids).toBe(before.stockVoids);

      // down quita el registro de la migración: Prisma la vería otra vez pendiente.
      expect(await rows(`SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '${R2}'`)).toHaveLength(0);
    },
    TIMEOUT
  );

  it(
    "up de nuevo termina en el MISMO estado que el primer up (estructura y datos)",
    async () => {
      await exec(`INSERT INTO "_prisma_migrations"(migration_name) VALUES ('${R2}')`);
      await run(sqlOf(R2));

      expect(await inSchema((tx) => structure(tx, SCHEMA))).toEqual(structureR2);
      const after = await fingerprint("createdByUserId");
      expect(after.counts).toEqual(before.counts);
      expect(after.users).toBe(before.users);
      expect(after.saleAuthors).toBe(before.saleAuthors);
      expect(after.paymentAuthors).toBe(before.paymentAuthors);
      const codes = await storeCodes();
      for (const c of codes) expect(c).toMatch(CODE_RE);
      expect(new Set(codes).size).toBe(3);
    },
    TIMEOUT
  );

  it(
    "down se niega a correr si ya hay empleados sin celular, y no cambia nada",
    async () => {
      await exec(
        `INSERT INTO "User"(id,"storeId",name,"pinHash","updatedAt",role,username) VALUES ('e1','s1','Empleado','h',now(),'EMPLOYEE','maria')`
      );
      await expect(run(sqlOf(R2, "down.sql"))).rejects.toThrow(/sin celular/);
      // Nada cambió: las columnas nuevas siguen ahí y el empleado también.
      expect(await inSchema((tx) => structure(tx, SCHEMA))).toEqual(structureR2);
      expect(await rows(`SELECT 1 FROM "User" WHERE id = 'e1' AND username = 'maria'`)).toHaveLength(1);
      await exec(`DELETE FROM "User" WHERE id = 'e1'`);
    },
    TIMEOUT
  );
});

describe("splitSql (herramienta de la prueba)", () => {
  it("respeta bloques $$, comillas y comentarios", () => {
    const parts = splitSql(`-- hola; mundo\nSELECT 'a;b';\nDO $$ BEGIN PERFORM 1; END $$;\nSELECT 2;`);
    expect(parts).toEqual(["SELECT 'a;b'", "DO $$ BEGIN PERFORM 1; END $$", "SELECT 2"]);
  });
});
