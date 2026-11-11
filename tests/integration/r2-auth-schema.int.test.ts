// R2 paso 1: lo que agrega la migración r2_auth_schema_autoria, probado contra Postgres real
// (BD de pruebas): código de tienda, restricciones de User, autoría y anulación, tablas de auth.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { storeDb, RelatedEntityError } from "@/lib/db";
import { generateStoreCode } from "@/lib/store-code";
import { prisma, rejection, resetDb, seedTwoStores, type Seed } from "./helpers";

let A: Seed;
let B: Seed;

// Prisma envuelve los errores de CHECK; se verifica por el nombre de la restricción.
const check = (name: string) => new RegExp(`check constraint.{0,4}${name}`, "i");

let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

beforeAll(resetDb);
beforeEach(async () => {
  await resetDb();
  ({ A, B } = await seedTwoStores());
});

describe("Store.code", () => {
  const mk = (code: string) => prisma.store.create({ data: { name: "T", phone: `S${uniq()}`, code } });

  it("acepta un código generado", async () => {
    const s = await mk(generateStoreCode());
    expect(s.code).toMatch(/^[2-9A-HJKMNP-TV-Z]{6}$/);
  });

  it("es único: el mismo código en otra tienda se rechaza (P2002)", async () => {
    const code = generateStoreCode();
    await mk(code);
    const err = await rejection(mk(code));
    expect(err.code).toBe("P2002");
  });

  it.each([
    ["K7M4Q", "5 caracteres"],
    ["K7M4QXX", "7 caracteres"],
    ["k7m4qx", "minúsculas"],
    ["K7M-4Q", "guion"],
    ["K7M4Q0", "contiene 0"],
    ["K7M4QO", "contiene O"],
    ["K7M4Q1", "contiene 1"],
    ["K7M4QI", "contiene I"],
    ["K7M4QL", "contiene L"],
    ["K7M4QU", "contiene U"],
    ["", "vacío"],
  ])("rechaza %j (%s) por CHECK de formato", async (code) => {
    const err = await rejection(mk(code));
    expect(err.message).toMatch(check("Store_code_format_chk"));
  });

  it("es obligatorio: un INSERT sin code falla por NOT NULL", async () => {
    const err = await rejection(
      prisma.$executeRawUnsafe(
        `INSERT INTO "Store"("id","name","phone","updatedAt") VALUES ($1,'T',$2,now())`,
        `x${uniq()}`,
        `S${uniq()}`
      )
    );
    expect(err.message).toMatch(/null value in column .{0,3}code|23502/i);
  });
});

describe("User: owner, empleado y username", () => {
  const owner = (storeId: string, extra: object = {}) =>
    prisma.user.create({ data: { storeId, name: "O", phone: `U${uniq()}`, pinHash: "x", ...extra } });
  const employee = (storeId: string, extra: object = {}) =>
    prisma.user.create({ data: { storeId, name: "E", role: "EMPLOYEE", pinHash: "x", ...extra } });

  it("valores por defecto: tokenVersion 0, pinHashVersion 1, sin cambio de PIN pendiente", async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: A.userId } });
    expect(u.role).toBe("OWNER");
    expect(u.tokenVersion).toBe(0);
    expect(u.pinHashVersion).toBe(1);
    expect(u.mustChangePin).toBe(false);
    expect(u.deactivatedAt).toBeNull();
    expect(u.lastLoginAt).toBeNull();
  });

  it("un OWNER sin celular (tienda sin dueño aún) se rechaza por CHECK", async () => {
    const store = await prisma.store.create({ data: { name: "T", phone: `S${uniq()}`, code: generateStoreCode() } });
    const err = await rejection(
      prisma.user.create({ data: { storeId: store.id, name: "O", pinHash: "x", role: "OWNER" } })
    );
    expect(err.message).toMatch(check("User_owner_requires_phone_chk"));
  });

  it("un EMPLOYEE sin usuario se rechaza", async () => {
    const err = await rejection(employee(A.storeId));
    expect(err.message).toMatch(check("User_employee_requires_username_chk"));
  });

  it("un EMPLOYEE con usuario y SIN celular se acepta; varios sin celular conviven (NULL)", async () => {
    const e1 = await employee(A.storeId, { username: "maria" });
    const e2 = await employee(A.storeId, { username: "pedro" });
    expect(e1.phone).toBeNull();
    expect(e2.phone).toBeNull();
  });

  it.each(["ab", "Maria", "a b", "ñandu", "x".repeat(21), "con-guion"])(
    "rechaza el usuario %j por formato",
    async (username) => {
      const err = await rejection(employee(A.storeId, { username }));
      expect(err.message).toMatch(check("User_username_format_chk"));
    }
  );

  it.each(["abc", "maria.lopez", "pedro_2", "a1b2c3", "x".repeat(20)])("acepta el usuario %j", async (username) => {
    const u = await employee(A.storeId, { username });
    expect(u.username).toBe(username);
  });

  it("el mismo usuario en dos tiendas es válido; repetido en la misma, P2002", async () => {
    await employee(A.storeId, { username: "caja" });
    await employee(B.storeId, { username: "caja" });
    const err = await rejection(employee(A.storeId, { username: "caja" }));
    expect(err.code).toBe("P2002");
  });

  it("solo un OWNER por tienda: el segundo se rechaza; los EMPLOYEE no tienen tope", async () => {
    const err = await rejection(owner(A.storeId));
    expect(err.code).toBe("P2002");
    for (const u of ["uno", "dos", "tres"]) await employee(A.storeId, { username: u });
    expect(await prisma.user.count({ where: { storeId: A.storeId } })).toBe(4);
  });

  it("el celular sigue siendo único global", async () => {
    const mine = await prisma.user.findUniqueOrThrow({ where: { id: A.userId } });
    const err = await rejection(owner(B.storeId, { phone: mine.phone }));
    expect(err.code).toBe("P2002");
  });

  it("tokenVersion negativo y pinHashVersion 0 se rechazan", async () => {
    const e1 = await rejection(prisma.user.update({ where: { id: A.userId }, data: { tokenVersion: -1 } }));
    expect(e1.message).toMatch(check("User_tokenVersion_nonneg_chk"));
    const e2 = await rejection(prisma.user.update({ where: { id: A.userId }, data: { pinHashVersion: 0 } }));
    expect(e2.message).toMatch(check("User_pinHashVersion_positive_chk"));
  });

  it("subir tokenVersion es atómico (increment)", async () => {
    await prisma.user.update({ where: { id: A.userId }, data: { tokenVersion: { increment: 1 } } });
    await prisma.user.update({ where: { id: A.userId }, data: { tokenVersion: { increment: 1 } } });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: A.userId } })).tokenVersion).toBe(2);
  });
});

describe("autoría (createdByUserId) y anulación (voidedByUserId)", () => {
  const sale = (extra: object = {}) =>
    prisma.sale.create({ data: { storeId: A.storeId, paymentType: "CASH", total: "1000", ...extra } });
  const payment = (extra: object = {}) =>
    prisma.payment.create({ data: { storeId: A.storeId, customerId: A.customerId, amount: "1000", ...extra } });

  it("una venta o abono NUEVO sin autor se rechaza (CHECK NOT VALID)", async () => {
    expect((await rejection(sale())).message).toMatch(check("Sale_created_by_required_chk"));
    expect((await rejection(payment())).message).toMatch(check("Payment_created_by_required_chk"));
  });

  it("con autor de la misma tienda se acepta", async () => {
    expect((await sale({ createdByUserId: A.userId })).createdByUserId).toBe(A.userId);
    expect((await payment({ createdByUserId: A.userId })).createdByUserId).toBe(A.userId);
  });

  it("un autor de OTRA tienda se rechaza por la FK compuesta (P2003)", async () => {
    expect((await rejection(sale({ createdByUserId: B.userId }))).code).toBe("P2003");
    expect((await rejection(payment({ createdByUserId: B.userId }))).code).toBe("P2003");
  });

  it.each([
    ["Sale", "Sale_void_pair_chk", () => prisma.sale.create({ data: { storeId: A.storeId, createdByUserId: A.userId, paymentType: "CASH", total: "1000", voidedAt: new Date() } })],
    ["Payment", "Payment_void_pair_chk", () => prisma.payment.create({ data: { storeId: A.storeId, createdByUserId: A.userId, customerId: A.customerId, amount: "1000", voidedAt: new Date() } })],
    ["StockEntry", "StockEntry_void_pair_chk", () => prisma.stockEntry.create({ data: { storeId: A.storeId, productId: A.productId, quantity: "1", totalCost: "1", unitCost: "1", voidedAt: new Date() } })],
  ])("%s: voidedAt sin voidedByUserId se rechaza", async (_n, name, op) => {
    expect((await rejection(op())).message).toMatch(check(name));
  });

  it.each([
    ["Sale", "Sale_void_pair_chk", () => prisma.sale.create({ data: { storeId: A.storeId, createdByUserId: A.userId, paymentType: "CASH", total: "1000", voidedByUserId: A.userId } })],
    ["Payment", "Payment_void_pair_chk", () => prisma.payment.create({ data: { storeId: A.storeId, createdByUserId: A.userId, customerId: A.customerId, amount: "1000", voidedByUserId: A.userId } })],
    ["StockEntry", "StockEntry_void_pair_chk", () => prisma.stockEntry.create({ data: { storeId: A.storeId, productId: A.productId, quantity: "1", totalCost: "1", unitCost: "1", voidedByUserId: A.userId } })],
  ])("%s: voidedByUserId sin voidedAt se rechaza", async (_n, name, op) => {
    expect((await rejection(op())).message).toMatch(check(name));
  });

  it("anulación completa (voidedAt + voidedByUserId de la misma tienda) se acepta", async () => {
    const s = await sale({ createdByUserId: A.userId, voidedAt: new Date(), voidedByUserId: A.userId });
    expect(s.voidedByUserId).toBe(A.userId);
  });

  it("storeDb.void guarda quién anuló", async () => {
    const db = storeDb(A.storeId);
    expect((await db.sale.void(A.saleId, A.userId)).count).toBe(1);
    const s = await prisma.sale.findUniqueOrThrow({ where: { id: A.saleId } });
    expect(s.voidedAt).not.toBeNull();
    expect(s.voidedByUserId).toBe(A.userId);
  });

  it("storeDb.void con un usuario de otra tienda: RelatedEntityError y la venta no se anula", async () => {
    const db = storeDb(A.storeId);
    await expect(db.sale.void(A.saleId, B.userId)).rejects.toBeInstanceOf(RelatedEntityError);
    const s = await prisma.sale.findUniqueOrThrow({ where: { id: A.saleId } });
    expect(s.voidedAt).toBeNull();
    expect(s.voidedByUserId).toBeNull();
  });

  it("storeDb.void de un movimiento de otra tienda no afecta ninguna fila", async () => {
    expect((await storeDb(A.storeId).sale.void(B.saleId, A.userId)).count).toBe(0);
  });

  it("el autor de una venta no se puede reasignar a un usuario de otra tienda", async () => {
    const err = await rejection(prisma.sale.update({ where: { id: A.saleId }, data: { createdByUserId: B.userId } }));
    expect(err.code).toBe("P2003");
  });

  it("un usuario con ventas o abonos no se puede borrar (Restrict): la autoría se conserva", async () => {
    const err = await rejection(prisma.user.delete({ where: { id: A.userId } }));
    expect(err.message).toMatch(/violates RESTRICT setting of foreign key constraint/);
  });
});

describe("tablas de autenticación", () => {
  it("AuthEvent: inserta cada tipo de evento y rechaza uno desconocido", async () => {
    const types = [
      "LOGIN_OK", "LOGIN_FAIL", "LOGIN_LOCKED", "LOGOUT", "PIN_CHANGED", "PIN_RESET_BY_OWNER",
      "SESSIONS_REVOKED", "EMPLOYEE_CREATED", "EMPLOYEE_DEACTIVATED", "EMPLOYEE_REACTIVATED", "STORE_REGISTERED",
    ] as const;
    for (const type of types) {
      await prisma.authEvent.create({ data: { type, ok: true, storeId: A.storeId, userId: A.userId } });
    }
    expect(await prisma.authEvent.count()).toBe(types.length);
    const err = await rejection(
      prisma.$executeRawUnsafe(`INSERT INTO "AuthEvent"("id","type","ok") VALUES ('x','NO_EXISTE',true)`)
    );
    expect(err.message).toMatch(/invalid input value for enum|22P02/i);
  });

  it("AuthEvent: un login fallido no necesita usuario ni tienda (referencias lógicas, sin FK)", async () => {
    const e = await prisma.authEvent.create({
      data: { type: "LOGIN_FAIL", ok: false, ipHash: "abc", userAgent: "ua", meta: { motivo: "pin" } },
    });
    expect(e.storeId).toBeNull();
    expect(e.userId).toBeNull();
  });

  it("AuthEvent sobrevive a la tienda y al usuario: no hay FK que lo borre o lo bloquee", async () => {
    await prisma.authEvent.create({ data: { type: "LOGIN_OK", ok: true, storeId: "no-existe", userId: "tampoco" } });
    expect(await prisma.authEvent.count()).toBe(1);
  });

  it("RateLimit: una fila por clave (PK) y valores por defecto en cero", async () => {
    const r = await prisma.rateLimit.create({ data: { key: "acct:hash" } });
    expect(r.fails).toBe(0);
    expect(r.strikes).toBe(0);
    expect(r.lockedUntil).toBeNull();
    const err = await rejection(prisma.rateLimit.create({ data: { key: "acct:hash" } }));
    expect(err.code).toBe("P2002");
  });

  it("RateLimit: el UPSERT atómico incrementa sin perder cuentas", async () => {
    const bump = () =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "RateLimit"("key","fails") VALUES ('k',1)
         ON CONFLICT ("key") DO UPDATE SET "fails" = "RateLimit"."fails" + 1, "updatedAt" = now()`
      );
    await Promise.all(Array.from({ length: 10 }, bump));
    expect((await prisma.rateLimit.findUniqueOrThrow({ where: { key: "k" } })).fails).toBe(10);
  });
});
