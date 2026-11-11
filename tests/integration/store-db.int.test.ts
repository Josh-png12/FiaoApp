// storeDb(storeId): nunca ve ni toca filas de otra tienda, y sus creates no aceptan
// storeId ni relaciones del cliente.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RelatedEntityError, storeDb } from "@/lib/db";
import { prisma, resetDb, seedTwoStores, type Seed } from "./helpers";

let A: Seed;
let B: Seed;

beforeAll(resetDb);
beforeEach(async () => {
  await resetDb();
  ({ A, B } = await seedTwoStores());
  // Movimientos de ambas tiendas para poder comparar agregados
  for (const s of [A, B]) {
    await prisma.sale.create({
      data: { storeId: s.storeId, createdByUserId: s.userId, paymentType: "CREDIT", total: s === A ? "2000" : "7000", customerId: s.customerId },
    });
    await prisma.payment.create({
      data: { storeId: s.storeId, createdByUserId: s.userId, customerId: s.customerId, amount: s === A ? "500" : "900" },
    });
    await prisma.saleItem.create({
      data: { storeId: s.storeId, saleId: s.saleId, productId: s.productId, quantity: "1", unitPrice: "1000" },
    });
  }
});

describe("lecturas: nunca devuelven filas de otra tienda", () => {
  it("customer.findMany / findFirst / count", async () => {
    const db = storeDb(A.storeId);
    const rows = await db.customer.findMany();
    expect(rows.map((r) => r.id)).toEqual([A.customerId]);
    expect(await db.customer.count()).toBe(1);
    expect(await db.customer.findFirst({ where: { id: B.customerId } })).toBeNull();
  });

  it("un where con storeId ajeno NO cambia de tienda", async () => {
    const db = storeDb(A.storeId);
    const rows = await db.customer.findMany({ where: { storeId: B.storeId } });
    expect(rows.map((r) => r.id)).toEqual([A.customerId]);
  });

  it("un where con OR que apunta a B no se escapa", async () => {
    const db = storeDb(A.storeId);
    const rows = await db.customer.findMany({
      where: { OR: [{ id: B.customerId }, { id: A.customerId }] },
    });
    expect(rows.map((r) => r.id)).toEqual([A.customerId]);
  });

  it("todos los modelos solo devuelven filas de la tienda propia", async () => {
    const db = storeDb(A.storeId);
    const results = await Promise.all([
      db.customer.findMany(),
      db.sale.findMany(),
      db.payment.findMany(),
      db.category.findMany(),
      db.product.findMany(),
      db.stockEntry.findMany(),
      db.saleItem.findMany(),
      db.cashClosing.findMany(),
      db.supplier.findMany(),
      db.supplierDebt.findMany(),
    ]);
    let total = 0;
    for (const rows of results) {
      for (const r of rows) {
        expect((r as { storeId: string }).storeId).toBe(A.storeId);
        total++;
      }
    }
    expect(total).toBeGreaterThan(0);
  });

  it("aggregate y count solo suman la tienda propia", async () => {
    const dbA = storeDb(A.storeId);
    const dbB = storeDb(B.storeId);
    const credit = (db: typeof dbA) =>
      db.sale.aggregate({ _sum: { total: true }, where: { paymentType: "CREDIT" } });
    expect((await credit(dbA))._sum?.total?.toString()).toBe("2000");
    expect((await credit(dbB))._sum?.total?.toString()).toBe("7000");
    expect((await dbA.payment.aggregate({ _sum: { amount: true } }))._sum?.amount?.toString()).toBe("500");
    expect(await dbA.saleItem.count()).toBe(1);
  });
});

describe("update / void con un id de otra tienda afectan 0 filas", () => {
  it("customer.update", async () => {
    const res = await storeDb(A.storeId).customer.update(B.customerId, { name: "HACKEADO" });
    expect(res.count).toBe(0);
    const other = await prisma.customer.findUniqueOrThrow({ where: { id: B.customerId } });
    expect(other.name).not.toBe("HACKEADO");
  });

  it("customer.update con un id propio sí actualiza", async () => {
    const res = await storeDb(A.storeId).customer.update(A.customerId, { name: "Renombrado" });
    expect(res.count).toBe(1);
  });

  it("product / category / supplier .update", async () => {
    const db = storeDb(A.storeId);
    expect((await db.product.update(B.productId, { name: "x" })).count).toBe(0);
    expect((await db.category.update(B.categoryId, { name: "x" })).count).toBe(0);
    expect((await db.supplier.update(B.supplierId, { name: "x" })).count).toBe(0);
  });

  it("sale.void y payment.void", async () => {
    const payB = await prisma.payment.findFirstOrThrow({ where: { storeId: B.storeId } });
    const db = storeDb(A.storeId);
    expect((await db.sale.void(B.saleId, A.userId)).count).toBe(0);
    expect((await db.payment.void(payB.id, A.userId)).count).toBe(0);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: B.saleId } })).voidedAt).toBeNull();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payB.id } })).voidedAt).toBeNull();
  });

  it("sale.void propio anula una sola vez (append-only: no se borra)", async () => {
    const db = storeDb(A.storeId);
    expect((await db.sale.void(A.saleId, A.userId)).count).toBe(1);
    expect((await db.sale.void(A.saleId, A.userId)).count).toBe(0);
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: A.saleId } });
    expect(sale.voidedAt).not.toBeNull();
  });
});

describe("create: el storeId lo pone storeDb y no se aceptan relaciones del cliente", () => {
  it("create válido queda en la tienda del storeDb", async () => {
    const c = await storeDb(A.storeId).customer.create({ name: "Nueva" });
    expect(c.storeId).toBe(A.storeId);
  });

  it("rechaza storeId en data", async () => {
    const db = storeDb(A.storeId);
    // @ts-expect-error storeId no está permitido por tipos; también se rechaza en runtime
    expect(() => db.customer.create({ name: "X", storeId: B.storeId })).toThrow(/storeId/);
  });

  it("rechaza store: { connect } en data", async () => {
    const db = storeDb(A.storeId);
    // @ts-expect-error relaciones no permitidas por tipos; también se rechazan en runtime
    expect(() => db.customer.create({ name: "X", store: { connect: { id: B.storeId } } })).toThrow(/store/);
  });

  it("rechaza connect / create anidados de relaciones", async () => {
    const db = storeDb(A.storeId);
    expect(() =>
      // @ts-expect-error relaciones no permitidas por tipos; también se rechazan en runtime
      db.payment.create({ amount: "1000", customer: { connect: { id: B.customerId } } })
    ).toThrow(/escalar|relaciones/);
    expect(() =>
      // @ts-expect-error relaciones no permitidas por tipos; también se rechazan en runtime
      db.customer.create({ name: "X", payments: { create: [{ amount: "1", storeId: B.storeId }] } })
    ).toThrow(/escalar|relaciones/);
  });

  it("cliente de otra tienda: RelatedEntityError genérico (422), sin revelar si existe", async () => {
    const db = storeDb(A.storeId);
    const grab = async (op: Promise<unknown>) => {
      try {
        await op;
      } catch (e) {
        return e;
      }
      throw new Error("Se esperaba un rechazo");
    };
    const e1 = await grab(db.payment.create({ createdByUserId: A.userId, customerId: B.customerId, amount: "1000" }));
    const e2 = await grab(db.payment.create({ createdByUserId: A.userId, customerId: "no-existe", amount: "1000" }));
    expect(e1).toBeInstanceOf(RelatedEntityError);
    expect(e2).toBeInstanceOf(RelatedEntityError);
    if (!(e1 instanceof RelatedEntityError) || !(e2 instanceof RelatedEntityError)) return;
    // Misma respuesta exacta para "es de otra tienda" y "no existe"
    expect(e1.message).toBe(e2.message);
    expect(e1.code).toBe(e2.code);
    expect(e1.status).toBe(422);
  });

  it("items de venta con producto de otra tienda: RelatedEntityError", async () => {
    await expect(
      storeDb(A.storeId).saleItem.create({
        saleId: A.saleId,
        productId: B.productId,
        quantity: "1",
        unitPrice: "1000",
      })
    ).rejects.toBeInstanceOf(RelatedEntityError);
  });

  it("no queda nada escrito tras un create rechazado", async () => {
    const before = await prisma.payment.count();
    await storeDb(A.storeId)
      .payment.create({ createdByUserId: A.userId, customerId: B.customerId, amount: "1000" })
      .catch(() => undefined);
    expect(await prisma.payment.count()).toBe(before);
  });
});
