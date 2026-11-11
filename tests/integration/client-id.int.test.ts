// clientId (idempotencia del sync offline) es único POR TIENDA, no global.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, rejection, resetDb, seedTwoStores, type Seed } from "./helpers";

let A: Seed;
let B: Seed;

beforeAll(resetDb);
beforeEach(async () => {
  await resetDb();
  ({ A, B } = await seedTwoStores());
});

const creators: { name: string; make: (s: Seed, clientId: string) => PromiseLike<unknown> }[] = [
  {
    name: "Customer",
    make: (s, clientId) => prisma.customer.create({ data: { storeId: s.storeId, name: "C", clientId } }),
  },
  {
    name: "Payment",
    make: (s, clientId) =>
      prisma.payment.create({ data: { storeId: s.storeId, createdByUserId: s.userId, customerId: s.customerId, amount: "1000", clientId } }),
  },
  {
    name: "Product",
    make: (s, clientId) =>
      prisma.product.create({ data: { storeId: s.storeId, name: "P", salePrice: "1000", clientId } }),
  },
  {
    name: "StockEntry",
    make: (s, clientId) =>
      prisma.stockEntry.create({
        data: { storeId: s.storeId, productId: s.productId, quantity: "1", totalCost: "1", unitCost: "1", clientId },
      }),
  },
  {
    name: "Sale",
    make: (s, clientId) =>
      prisma.sale.create({ data: { storeId: s.storeId, createdByUserId: s.userId, paymentType: "CASH", total: "1000", clientId } }),
  },
  {
    name: "CashClosing",
    make: (s, clientId) =>
      prisma.cashClosing.create({
        data: {
          storeId: s.storeId,
          date: new Date("2026-11-10"),
          expectedCash: "0",
          countedCash: "0",
          difference: "0",
          clientId,
        },
      }),
  },
];

describe.each(creators)("clientId en $name", ({ make }) => {
  const clientId = "7b1f6c2e-5a43-4d0a-9d55-0c8f3e1a2b4d";

  it("el mismo clientId en tiendas distintas está permitido", async () => {
    await make(A, clientId);
    await expect(Promise.resolve(make(B, clientId))).resolves.toBeDefined();
  });

  it("el mismo clientId repetido en la misma tienda se rechaza (P2002)", async () => {
    await make(A, clientId);
    const err = await rejection(make(A, clientId));
    expect(err.code).toBe("P2002");
  });

  it("varias filas sin clientId (NULL) conviven", async () => {
    await make(A, null as unknown as string);
    await expect(Promise.resolve(make(A, null as unknown as string))).resolves.toBeDefined();
  });
});

describe("clientId: tras el rechazo la BD queda intacta (reintento inocuo)", () => {
  it("el segundo intento no duplica la fila", async () => {
    const clientId = "11111111-2222-4333-8444-555555555555";
    await prisma.customer.create({ data: { storeId: A.storeId, name: "Ana", clientId } });
    await rejection(prisma.customer.create({ data: { storeId: A.storeId, name: "Ana", clientId } }));
    expect(await prisma.customer.count({ where: { storeId: A.storeId, clientId } })).toBe(1);
  });
});
