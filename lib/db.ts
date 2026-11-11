// =====================================================================
// lib/db.ts — Acceso a datos multi-tenant.
// Regla NO negociable: TODO query de negocio filtra por storeId.
// Las rutas NUNCA llaman prisma.<model> directo: usan storeDb(storeId)
// (ESLint lo hace cumplir: @/lib/prisma solo se importa desde lib/ y app/api/auth/).
//
// Defensa en capas:
//  1. Lecturas/updates/anulaciones: storeId inyectado en el `where`.
//  2. Creates: solo datos ESCALARES (sin `store`, `storeId` ni `connect`/`create`
//     de relaciones). El storeId lo pone storeDb; las FK compuestas
//     (xId, storeId) de la BD impiden relacionar filas de otra tienda.
//  3. Si la BD rechaza una FK (P2003) se traduce a RelatedEntityError, genérico,
//     sin revelar si el ID existe en otra tienda.
// =====================================================================
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Mezcla el filtro de tienda en un `where` arbitrario.
 * Pura y exportada para poder testearla sin base de datos.
 */
export function withStore<W extends Record<string, unknown> | undefined>(
  storeId: string,
  where?: W
): NonNullable<W> & { storeId: string } {
  if (!storeId) throw new Error("storeId es obligatorio");
  return { ...(where ?? {}), storeId } as NonNullable<W> & { storeId: string };
}

/**
 * Una entidad relacionada (cliente, producto, usuario…) no existe o no es de
 * esta tienda. Mensaje y código genéricos a propósito: no revelan si el ID
 * pertenece a otra tienda. La ruta lo responde como 422 (o 404).
 */
export class RelatedEntityError extends Error {
  readonly code = "RELATED_ENTITY_NOT_FOUND" as const;
  readonly status = 422 as const;
  constructor() {
    super("Alguno de los datos relacionados no existe.");
    this.name = "RelatedEntityError";
  }
}

/** Datos de creación: solo escalares y sin storeId (lo inyecta storeDb). */
type ScalarCreate<T> = Omit<T, "storeId">;

function assertNoStoreKeys(data: object): void {
  for (const key of ["store", "storeId"]) {
    if (key in data) {
      throw new Error(`'${key}' no se acepta en data: la tienda la pone storeDb`);
    }
  }
}

/** Exporta para tests. Rechaza store/storeId y cualquier valor que no sea escalar. */
export function assertScalarData(data: object): void {
  assertNoStoreKeys(data);
  for (const [key, value] of Object.entries(data)) {
    const isObject = value !== null && typeof value === "object";
    if (isObject && !(value instanceof Date) && !Prisma.Decimal.isDecimal(value)) {
      throw new Error(`'${key}' no es un valor escalar: no se permiten relaciones ni connect`);
    }
  }
}

async function translateFkError<T>(op: () => PromiseLike<T>): Promise<T> {
  try {
    return await op();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      throw new RelatedEntityError();
    }
    throw e;
  }
}

/**
 * Cliente de datos con storeId inyectado en todos los modelos de negocio.
 * Uso en rutas: const db = storeDb(session.storeId); db.customer.findMany(...)
 *
 * - Entidades editables (customer, category, product, supplier, supplierDebt): `update`.
 * - Movimientos append-only (sale, payment, stockEntry): `void`, nunca update/delete.
 * - saleItem y cashClosing: solo lectura y creación.
 */
export function storeDb(storeId: string) {
  if (!storeId) throw new Error("storeId es obligatorio");

  return {
    customer: {
      findMany: (args?: Prisma.CustomerFindManyArgs) =>
        prisma.customer.findMany({ ...args, where: withStore(storeId, args?.where) }),
      findFirst: (args?: Prisma.CustomerFindFirstArgs) =>
        prisma.customer.findFirst({ ...args, where: withStore(storeId, args?.where) }),
      count: (args?: Prisma.CustomerCountArgs) =>
        prisma.customer.count({ ...args, where: withStore(storeId, args?.where) }),
      create: (data: ScalarCreate<Prisma.CustomerCreateManyInput>) => {
        assertScalarData(data);
        return translateFkError(() => prisma.customer.create({ data: { ...data, storeId } }));
      },
      /** update seguro: verifica pertenencia a la tienda vía updateMany */
      update: (id: string, data: Prisma.CustomerUpdateManyMutationInput) => {
        assertNoStoreKeys(data);
        return prisma.customer.updateMany({ where: { id, storeId }, data });
      },
    },

    sale: {
      findMany: (args?: Prisma.SaleFindManyArgs) =>
        prisma.sale.findMany({ ...args, where: withStore(storeId, args?.where) }),
      findFirst: (args?: Prisma.SaleFindFirstArgs) =>
        prisma.sale.findFirst({ ...args, where: withStore(storeId, args?.where) }),
      count: (args?: Prisma.SaleCountArgs) =>
        prisma.sale.count({ ...args, where: withStore(storeId, args?.where) }),
      aggregate: (args: Prisma.SaleAggregateArgs) =>
        prisma.sale.aggregate({ ...args, where: withStore(storeId, args?.where) }),
      create: (data: ScalarCreate<Prisma.SaleCreateManyInput>) => {
        assertScalarData(data);
        return translateFkError(() => prisma.sale.create({ data: { ...data, storeId } }));
      },
      /** Anular (append-only): nunca borrar ni editar montos. */
      void: (id: string) =>
        prisma.sale.updateMany({ where: { id, storeId, voidedAt: null }, data: { voidedAt: new Date() } }),
    },

    payment: {
      findMany: (args?: Prisma.PaymentFindManyArgs) =>
        prisma.payment.findMany({ ...args, where: withStore(storeId, args?.where) }),
      findFirst: (args?: Prisma.PaymentFindFirstArgs) =>
        prisma.payment.findFirst({ ...args, where: withStore(storeId, args?.where) }),
      count: (args?: Prisma.PaymentCountArgs) =>
        prisma.payment.count({ ...args, where: withStore(storeId, args?.where) }),
      aggregate: (args: Prisma.PaymentAggregateArgs) =>
        prisma.payment.aggregate({ ...args, where: withStore(storeId, args?.where) }),
      create: (data: ScalarCreate<Prisma.PaymentCreateManyInput>) => {
        assertScalarData(data);
        return translateFkError(() => prisma.payment.create({ data: { ...data, storeId } }));
      },
      void: (id: string) =>
        prisma.payment.updateMany({ where: { id, storeId, voidedAt: null }, data: { voidedAt: new Date() } }),
    },

    category: {
      findMany: (args?: Prisma.CategoryFindManyArgs) =>
        prisma.category.findMany({ ...args, where: withStore(storeId, args?.where) }),
      findFirst: (args?: Prisma.CategoryFindFirstArgs) =>
        prisma.category.findFirst({ ...args, where: withStore(storeId, args?.where) }),
      count: (args?: Prisma.CategoryCountArgs) =>
        prisma.category.count({ ...args, where: withStore(storeId, args?.where) }),
      create: (data: ScalarCreate<Prisma.CategoryCreateManyInput>) => {
        assertScalarData(data);
        return translateFkError(() => prisma.category.create({ data: { ...data, storeId } }));
      },
      update: (id: string, data: Prisma.CategoryUpdateManyMutationInput) => {
        assertNoStoreKeys(data);
        return prisma.category.updateMany({ where: { id, storeId }, data });
      },
    },

    product: {
      findMany: (args?: Prisma.ProductFindManyArgs) =>
        prisma.product.findMany({ ...args, where: withStore(storeId, args?.where) }),
      findFirst: (args?: Prisma.ProductFindFirstArgs) =>
        prisma.product.findFirst({ ...args, where: withStore(storeId, args?.where) }),
      count: (args?: Prisma.ProductCountArgs) =>
        prisma.product.count({ ...args, where: withStore(storeId, args?.where) }),
      create: (data: ScalarCreate<Prisma.ProductCreateManyInput>) => {
        assertScalarData(data);
        return translateFkError(() => prisma.product.create({ data: { ...data, storeId } }));
      },
      update: (id: string, data: Prisma.ProductUpdateManyMutationInput) => {
        assertNoStoreKeys(data);
        return prisma.product.updateMany({ where: { id, storeId }, data });
      },
    },

    stockEntry: {
      findMany: (args?: Prisma.StockEntryFindManyArgs) =>
        prisma.stockEntry.findMany({ ...args, where: withStore(storeId, args?.where) }),
      findFirst: (args?: Prisma.StockEntryFindFirstArgs) =>
        prisma.stockEntry.findFirst({ ...args, where: withStore(storeId, args?.where) }),
      count: (args?: Prisma.StockEntryCountArgs) =>
        prisma.stockEntry.count({ ...args, where: withStore(storeId, args?.where) }),
      aggregate: (args: Prisma.StockEntryAggregateArgs) =>
        prisma.stockEntry.aggregate({ ...args, where: withStore(storeId, args?.where) }),
      create: (data: ScalarCreate<Prisma.StockEntryCreateManyInput>) => {
        assertScalarData(data);
        return translateFkError(() => prisma.stockEntry.create({ data: { ...data, storeId } }));
      },
      void: (id: string) =>
        prisma.stockEntry.updateMany({ where: { id, storeId, voidedAt: null }, data: { voidedAt: new Date() } }),
    },

    saleItem: {
      findMany: (args?: Prisma.SaleItemFindManyArgs) =>
        prisma.saleItem.findMany({ ...args, where: withStore(storeId, args?.where) }),
      findFirst: (args?: Prisma.SaleItemFindFirstArgs) =>
        prisma.saleItem.findFirst({ ...args, where: withStore(storeId, args?.where) }),
      count: (args?: Prisma.SaleItemCountArgs) =>
        prisma.saleItem.count({ ...args, where: withStore(storeId, args?.where) }),
      aggregate: (args: Prisma.SaleItemAggregateArgs) =>
        prisma.saleItem.aggregate({ ...args, where: withStore(storeId, args?.where) }),
      create: (data: ScalarCreate<Prisma.SaleItemCreateManyInput>) => {
        assertScalarData(data);
        return translateFkError(() => prisma.saleItem.create({ data: { ...data, storeId } }));
      },
    },

    cashClosing: {
      findMany: (args?: Prisma.CashClosingFindManyArgs) =>
        prisma.cashClosing.findMany({ ...args, where: withStore(storeId, args?.where) }),
      findFirst: (args?: Prisma.CashClosingFindFirstArgs) =>
        prisma.cashClosing.findFirst({ ...args, where: withStore(storeId, args?.where) }),
      count: (args?: Prisma.CashClosingCountArgs) =>
        prisma.cashClosing.count({ ...args, where: withStore(storeId, args?.where) }),
      create: (data: ScalarCreate<Prisma.CashClosingCreateManyInput>) => {
        assertScalarData(data);
        return translateFkError(() => prisma.cashClosing.create({ data: { ...data, storeId } }));
      },
    },

    supplier: {
      findMany: (args?: Prisma.SupplierFindManyArgs) =>
        prisma.supplier.findMany({ ...args, where: withStore(storeId, args?.where) }),
      findFirst: (args?: Prisma.SupplierFindFirstArgs) =>
        prisma.supplier.findFirst({ ...args, where: withStore(storeId, args?.where) }),
      count: (args?: Prisma.SupplierCountArgs) =>
        prisma.supplier.count({ ...args, where: withStore(storeId, args?.where) }),
      create: (data: ScalarCreate<Prisma.SupplierCreateManyInput>) => {
        assertScalarData(data);
        return translateFkError(() => prisma.supplier.create({ data: { ...data, storeId } }));
      },
      update: (id: string, data: Prisma.SupplierUpdateManyMutationInput) => {
        assertNoStoreKeys(data);
        return prisma.supplier.updateMany({ where: { id, storeId }, data });
      },
    },

    supplierDebt: {
      findMany: (args?: Prisma.SupplierDebtFindManyArgs) =>
        prisma.supplierDebt.findMany({ ...args, where: withStore(storeId, args?.where) }),
      findFirst: (args?: Prisma.SupplierDebtFindFirstArgs) =>
        prisma.supplierDebt.findFirst({ ...args, where: withStore(storeId, args?.where) }),
      count: (args?: Prisma.SupplierDebtCountArgs) =>
        prisma.supplierDebt.count({ ...args, where: withStore(storeId, args?.where) }),
      aggregate: (args: Prisma.SupplierDebtAggregateArgs) =>
        prisma.supplierDebt.aggregate({ ...args, where: withStore(storeId, args?.where) }),
      create: (data: ScalarCreate<Prisma.SupplierDebtCreateManyInput>) => {
        assertScalarData(data);
        return translateFkError(() => prisma.supplierDebt.create({ data: { ...data, storeId } }));
      },
      update: (id: string, data: Prisma.SupplierDebtUpdateManyMutationInput) => {
        assertNoStoreKeys(data);
        return prisma.supplierDebt.updateMany({ where: { id, storeId }, data });
      },
    },
  };
}

export type StoreDb = ReturnType<typeof storeDb>;
