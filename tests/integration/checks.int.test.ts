// Los 4 CHECK constraints de la migración r1, probados contra Postgres real.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, rejection, resetDb, seedStore, type Seed } from "./helpers";

const CHECK = /check constraint|violates check|_chk/i;

let A: Seed;

beforeAll(resetDb);
beforeEach(async () => {
  await resetDb();
  A = await seedStore("A");
});

describe("CHECK: un fiado (CREDIT) siempre tiene cliente", () => {
  it("rechaza CREDIT sin customerId", async () => {
    const err = await rejection(
      prisma.sale.create({ data: { storeId: A.storeId, createdByUserId: A.userId, paymentType: "CREDIT", total: "5000" } })
    );
    expect(err.message).toMatch(CHECK);
  });

  it("acepta CREDIT con cliente (control)", async () => {
    const sale = await prisma.sale.create({
      data: { storeId: A.storeId, createdByUserId: A.userId, paymentType: "CREDIT", total: "5000", customerId: A.customerId },
    });
    expect(sale.customerId).toBe(A.customerId);
  });

  it("acepta una venta de contado sin cliente (control)", async () => {
    for (const paymentType of ["CASH", "NEQUI", "DAVIPLATA"] as const) {
      await prisma.sale.create({ data: { storeId: A.storeId, createdByUserId: A.userId, paymentType, total: "5000" } });
    }
  });
});

describe("CHECK: Sale.total > 0", () => {
  it.each(["0", "-1", "-5000"])("rechaza total = %s", async (total) => {
    const err = await rejection(
      prisma.sale.create({ data: { storeId: A.storeId, createdByUserId: A.userId, paymentType: "CASH", total } })
    );
    expect(err.message).toMatch(CHECK);
  });

  it("acepta total = 1 (control)", async () => {
    await prisma.sale.create({ data: { storeId: A.storeId, createdByUserId: A.userId, paymentType: "CASH", total: "1" } });
  });
});

describe("CHECK: Payment.amount > 0", () => {
  it.each(["0", "-1", "-5000"])("rechaza amount = %s", async (amount) => {
    const err = await rejection(
      prisma.payment.create({ data: { storeId: A.storeId, createdByUserId: A.userId, customerId: A.customerId, amount } })
    );
    expect(err.message).toMatch(CHECK);
  });

  it("acepta amount = 1 (control)", async () => {
    await prisma.payment.create({
      data: { storeId: A.storeId, createdByUserId: A.userId, customerId: A.customerId, amount: "1" },
    });
  });
});

describe("CHECK: SaleItem.quantity > 0", () => {
  const item = (quantity: string) => ({
    storeId: A.storeId,
    saleId: A.saleId,
    productId: A.productId,
    quantity,
    unitPrice: "1000",
  });

  it.each(["0", "-1", "-0.5"])("rechaza quantity = %s", async (quantity) => {
    const err = await rejection(prisma.saleItem.create({ data: item(quantity) }));
    expect(err.message).toMatch(CHECK);
  });

  it("acepta fracciones positivas, p. ej. 0.250 lb (control)", async () => {
    await prisma.saleItem.create({ data: item("0.250") });
  });
});
