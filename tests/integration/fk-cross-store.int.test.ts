// Aislamiento entre tiendas A y B a nivel de BASE DE DATOS: cada FK compuesta
// (xId, storeId) debe rechazar un id de otra tienda. Sin pasar por storeDb.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, rejection, resetDb, seedTwoStores, type Seed } from "./helpers";

let A: Seed;
let B: Seed;

// Postgres responde 23001 (restrict_violation) a UPDATE/DELETE bloqueados por ON ... RESTRICT;
// Prisma lo envuelve como error sin código, así que se verifica por mensaje + nombre de la FK.
const restrict = (fk: string) =>
  // Prisma escapa las comillas dentro del mensaje (\"fk\"): se toleran 0–3 caracteres antes del nombre.
  new RegExp(`violates RESTRICT setting of foreign key constraint .{0,3}${fk}`);

beforeAll(resetDb);
beforeEach(async () => {
  await resetDb();
  ({ A, B } = await seedTwoStores());
});

/**
 * Una entrada por FK compuesta: `make(own, foreign)` crea una fila en la tienda `own`
 * apuntando a la entidad `foreign` (ids de la otra tienda, o de la misma en el control).
 */
const relations: {
  name: string;
  make: (own: Seed, ref: Seed) => PromiseLike<unknown>;
}[] = [
  {
    name: "Payment.customer",
    make: (own, ref) =>
      prisma.payment.create({
        data: { storeId: own.storeId, createdByUserId: own.userId, customerId: ref.customerId, amount: "1000" },
      }),
  },
  {
    name: "Payment.createdBy",
    make: (own, ref) =>
      prisma.payment.create({
        data: { storeId: own.storeId, customerId: own.customerId, createdByUserId: ref.userId, amount: "1000" },
      }),
  },
  {
    name: "Product.category",
    make: (own, ref) =>
      prisma.product.create({
        data: { storeId: own.storeId, name: "P", salePrice: "1000", categoryId: ref.categoryId },
      }),
  },
  {
    name: "StockEntry.product",
    make: (own, ref) =>
      prisma.stockEntry.create({
        data: { storeId: own.storeId, productId: ref.productId, quantity: "1", totalCost: "500", unitCost: "500" },
      }),
  },
  {
    name: "StockEntry.supplier",
    make: (own, ref) =>
      prisma.stockEntry.create({
        data: {
          storeId: own.storeId,
          productId: own.productId,
          supplierId: ref.supplierId,
          quantity: "1",
          totalCost: "500",
          unitCost: "500",
        },
      }),
  },
  {
    name: "Sale.createdBy",
    make: (own, ref) =>
      prisma.sale.create({
        data: { storeId: own.storeId, paymentType: "CASH", total: "1000", createdByUserId: ref.userId },
      }),
  },
  {
    name: "Sale.customer",
    make: (own, ref) =>
      prisma.sale.create({
        data: { storeId: own.storeId, createdByUserId: own.userId, paymentType: "CREDIT", total: "1000", customerId: ref.customerId },
      }),
  },
  {
    name: "SaleItem.sale",
    make: (own, ref) =>
      prisma.saleItem.create({
        data: { storeId: own.storeId, saleId: ref.saleId, productId: own.productId, quantity: "1", unitPrice: "1000" },
      }),
  },
  {
    name: "SaleItem.product",
    make: (own, ref) =>
      prisma.saleItem.create({
        data: { storeId: own.storeId, saleId: own.saleId, productId: ref.productId, quantity: "1", unitPrice: "1000" },
      }),
  },
  {
    name: "CashClosing.user",
    make: (own, ref) =>
      prisma.cashClosing.create({
        data: {
          storeId: own.storeId,
          userId: ref.userId,
          date: new Date("2026-11-10"),
          expectedCash: "0",
          countedCash: "0",
          difference: "0",
        },
      }),
  },
  {
    name: "Payment.voidedBy",
    make: (own, ref) =>
      prisma.payment.create({
        data: {
          storeId: own.storeId,
          createdByUserId: own.userId,
          customerId: own.customerId,
          amount: "1000",
          voidedAt: new Date(),
          voidedByUserId: ref.userId,
        },
      }),
  },
  {
    name: "Sale.voidedBy",
    make: (own, ref) =>
      prisma.sale.create({
        data: {
          storeId: own.storeId,
          createdByUserId: own.userId,
          paymentType: "CASH",
          total: "1000",
          voidedAt: new Date(),
          voidedByUserId: ref.userId,
        },
      }),
  },
  {
    name: "StockEntry.voidedBy",
    make: (own, ref) =>
      prisma.stockEntry.create({
        data: {
          storeId: own.storeId,
          productId: own.productId,
          quantity: "1",
          totalCost: "500",
          unitCost: "500",
          voidedAt: new Date(),
          voidedByUserId: ref.userId,
        },
      }),
  },
  {
    name: "SupplierDebt.supplier",
    make: (own, ref) =>
      prisma.supplierDebt.create({ data: { storeId: own.storeId, supplierId: ref.supplierId, amount: "1000" } }),
  },
];

describe("FK compuestas: una fila de la tienda A NO puede apuntar a una entidad de B", () => {
  it.each(relations)("$name: rechazado con violación de FK (P2003)", async ({ make }) => {
    const err = await rejection(make(A, B));
    expect(err.code).toBe("P2003");
  });

  it.each(relations)("$name: control, la misma tienda sí se acepta", async ({ make }) => {
    await expect(Promise.resolve(make(A, A))).resolves.toBeDefined();
  });

  it("el rechazo es simétrico: B tampoco puede apuntar a A", async () => {
    for (const { make } of relations) {
      const err = await rejection(make(B, A));
      expect(err.code).toBe("P2003");
    }
  });
});

describe("FK opcionales: NULL se acepta (MATCH SIMPLE no evalúa la FK)", () => {
  it("Sale sin cliente", async () => {
    const sale = await prisma.sale.create({
      data: { storeId: A.storeId, createdByUserId: A.userId, paymentType: "CASH", total: "1000", customerId: null },
    });
    expect(sale.customerId).toBeNull();
  });

  it("Payment sin anulación (voidedByUserId null)", async () => {
    const p = await prisma.payment.create({
      data: { storeId: A.storeId, createdByUserId: A.userId, customerId: A.customerId, voidedByUserId: null, amount: "1000" },
    });
    expect(p.voidedByUserId).toBeNull();
  });

  it("Product sin categoría", async () => {
    const p = await prisma.product.create({
      data: { storeId: A.storeId, name: "Sin cat", salePrice: "1000", categoryId: null },
    });
    expect(p.categoryId).toBeNull();
  });

  it("StockEntry sin proveedor", async () => {
    const e = await prisma.stockEntry.create({
      data: { storeId: A.storeId, productId: A.productId, supplierId: null, quantity: "1", totalCost: "1", unitCost: "1" },
    });
    expect(e.supplierId).toBeNull();
  });

  it("CashClosing sin usuario", async () => {
    const c = await prisma.cashClosing.create({
      data: { storeId: A.storeId, userId: null, date: new Date("2026-11-10"), expectedCash: "0", countedCash: "0", difference: "0" },
    });
    expect(c.userId).toBeNull();
  });
});

describe("UPDATE de storeId: no arrastra ni deja huérfanos los movimientos (ON UPDATE RESTRICT)", () => {
  it("customer con abonos: no se puede mover a otra tienda", async () => {
    await prisma.payment.create({
      data: { storeId: A.storeId, createdByUserId: A.userId, customerId: A.customerId, amount: "1000" },
    });
    const err = await rejection(
      prisma.customer.update({ where: { id: A.customerId }, data: { storeId: B.storeId } })
    );
    expect(err.message).toMatch(restrict("Payment_customerId_storeId_fkey"));
    const still = await prisma.customer.findUniqueOrThrow({ where: { id: A.customerId } });
    expect(still.storeId).toBe(A.storeId);
  });

  it("customer con fiados: no se puede mover", async () => {
    await prisma.sale.create({
      data: { storeId: A.storeId, createdByUserId: A.userId, paymentType: "CREDIT", total: "1000", customerId: A.customerId },
    });
    const err = await rejection(
      prisma.customer.update({ where: { id: A.customerId }, data: { storeId: B.storeId } })
    );
    expect(err.message).toMatch(restrict("Sale_customerId_storeId_fkey"));
  });

  it("empleado con ventas registradas: no se puede mover a otra tienda (FK de autoría)", async () => {
    const emp = await prisma.user.create({
      data: { storeId: A.storeId, name: "Emp", role: "EMPLOYEE", username: "caja", pinHash: "x" },
    });
    await prisma.sale.create({
      data: { storeId: A.storeId, createdByUserId: emp.id, paymentType: "CASH", total: "1000" },
    });
    const err = await rejection(prisma.user.update({ where: { id: emp.id }, data: { storeId: B.storeId } }));
    expect(err.message).toMatch(restrict("Sale_createdByUserId_storeId_fkey"));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: emp.id } })).storeId).toBe(A.storeId);
  });

  it("empleado que anuló un abono: no se puede mover a otra tienda (FK de anulación)", async () => {
    const emp = await prisma.user.create({
      data: { storeId: A.storeId, name: "Emp", role: "EMPLOYEE", username: "anula", pinHash: "x" },
    });
    await prisma.payment.create({
      data: {
        storeId: A.storeId,
        createdByUserId: A.userId,
        customerId: A.customerId,
        amount: "1000",
        voidedAt: new Date(),
        voidedByUserId: emp.id,
      },
    });
    const err = await rejection(prisma.user.update({ where: { id: emp.id }, data: { storeId: B.storeId } }));
    expect(err.message).toMatch(restrict("Payment_voidedByUserId_storeId_fkey"));
  });

  it("el OWNER de una tienda no se puede mover a otra que ya tiene OWNER (índice de un solo OWNER)", async () => {
    const err = await rejection(prisma.user.update({ where: { id: A.userId }, data: { storeId: B.storeId } }));
    expect(err.code).toBe("P2002");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: A.userId } })).storeId).toBe(A.storeId);
  });

  it("producto con ítems de venta: no se puede mover", async () => {
    await prisma.saleItem.create({
      data: { storeId: A.storeId, saleId: A.saleId, productId: A.productId, quantity: "1", unitPrice: "1000" },
    });
    const err = await rejection(
      prisma.product.update({ where: { id: A.productId }, data: { storeId: B.storeId } })
    );
    expect(err.message).toMatch(restrict("SaleItem_productId_storeId_fkey"));
  });

  it("venta con ítems: no se puede mover", async () => {
    await prisma.saleItem.create({
      data: { storeId: A.storeId, saleId: A.saleId, productId: A.productId, quantity: "1", unitPrice: "1000" },
    });
    const err = await rejection(
      prisma.sale.update({ where: { id: A.saleId }, data: { storeId: B.storeId } })
    );
    expect(err.message).toMatch(restrict("SaleItem_saleId_storeId_fkey"));
  });

  it("no se puede reescribir el storeId de un abono para colgarlo del cliente de B", async () => {
    const pay = await prisma.payment.create({
      data: { storeId: A.storeId, createdByUserId: A.userId, customerId: A.customerId, amount: "1000" },
    });
    const err = await rejection(
      prisma.payment.update({ where: { id: pay.id }, data: { storeId: B.storeId } })
    );
    expect(err.code).toBe("P2003");
  });
});

describe("ON DELETE RESTRICT: nada con movimientos se borra", () => {
  it("customer con abonos no se puede borrar", async () => {
    await prisma.payment.create({ data: { storeId: A.storeId, createdByUserId: A.userId, customerId: A.customerId, amount: "1000" } });
    const err = await rejection(prisma.customer.delete({ where: { id: A.customerId } }));
    expect(err.message).toMatch(restrict("Payment_customerId_storeId_fkey"));
  });

  it("venta con ítems no se puede borrar (antes era Cascade)", async () => {
    await prisma.saleItem.create({
      data: { storeId: A.storeId, saleId: A.saleId, productId: A.productId, quantity: "1", unitPrice: "1000" },
    });
    const err = await rejection(prisma.sale.delete({ where: { id: A.saleId } }));
    expect(err.message).toMatch(restrict("SaleItem_saleId_storeId_fkey"));
    expect(await prisma.saleItem.count({ where: { storeId: A.storeId } })).toBe(1);
  });
});
