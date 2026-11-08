// =====================================================================
// lib/db.ts — Acceso a datos multi-tenant.
// Regla NO negociable: TODO query de negocio filtra por storeId.
// Las rutas NUNCA llaman prisma.<model> directo: usan storeDb(storeId).
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
 * Cliente de datos con storeId inyectado en todos los modelos de negocio.
 * Uso en rutas: const db = storeDb(session.storeId); db.customer.findMany(...)
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
      create: (args: Omit<Prisma.CustomerCreateArgs, "data"> & { data: Omit<Prisma.CustomerCreateInput, "store"> }) =>
        prisma.customer.create({ ...args, data: { ...args.data, store: { connect: { id: storeId } } } }),
      /** update seguro: verifica pertenencia a la tienda vía updateMany */
      update: (id: string, data: Prisma.CustomerUpdateManyMutationInput) =>
        prisma.customer.updateMany({ where: { id, storeId }, data }),
    },

    sale: {
      findMany: (args?: Prisma.SaleFindManyArgs) =>
        prisma.sale.findMany({ ...args, where: withStore(storeId, args?.where) }),
      findFirst: (args?: Prisma.SaleFindFirstArgs) =>
        prisma.sale.findFirst({ ...args, where: withStore(storeId, args?.where) }),
      aggregate: (args: Prisma.SaleAggregateArgs) =>
        prisma.sale.aggregate({ ...args, where: withStore(storeId, args?.where) }),
      create: (args: Omit<Prisma.SaleCreateArgs, "data"> & { data: Omit<Prisma.SaleCreateInput, "store"> }) =>
        prisma.sale.create({ ...args, data: { ...args.data, store: { connect: { id: storeId } } } }),
      /** Anular (append-only): nunca borrar ni editar montos. */
      void: (id: string) =>
        prisma.sale.updateMany({ where: { id, storeId, voidedAt: null }, data: { voidedAt: new Date() } }),
    },

    payment: {
      findMany: (args?: Prisma.PaymentFindManyArgs) =>
        prisma.payment.findMany({ ...args, where: withStore(storeId, args?.where) }),
      aggregate: (args: Prisma.PaymentAggregateArgs) =>
        prisma.payment.aggregate({ ...args, where: withStore(storeId, args?.where) }),
      create: (args: Omit<Prisma.PaymentCreateArgs, "data"> & { data: Omit<Prisma.PaymentCreateInput, "store"> }) =>
        prisma.payment.create({ ...args, data: { ...args.data, store: { connect: { id: storeId } } } }),
      void: (id: string) =>
        prisma.payment.updateMany({ where: { id, storeId, voidedAt: null }, data: { voidedAt: new Date() } }),
    },
  };
}

export type StoreDb = ReturnType<typeof storeDb>;
