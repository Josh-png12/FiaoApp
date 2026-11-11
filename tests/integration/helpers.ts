// Utilidades compartidas de las pruebas de integración (dos tiendas A y B).
// Usan el cliente Prisma crudo a propósito: hay que intentar escrituras que
// storeDb no permitiría y comprobar que la BD las rechaza por sí sola.
import { prisma } from "@/lib/prisma";
import { generateStoreCode } from "@/lib/store-code";

export { prisma };

let counter = 0;
const next = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Vacía todas las tablas de negocio (solo existe la BD de pruebas aquí). */
export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AuthEvent","RateLimit","SaleItem","Sale","Payment","StockEntry","SupplierDebt","CashClosing",' +
      '"Product","Category","Supplier","Customer","User","Store" RESTART IDENTITY CASCADE'
  );
}

export interface Seed {
  storeId: string;
  userId: string;
  customerId: string;
  categoryId: string;
  supplierId: string;
  productId: string;
  saleId: string;
}

/** Crea una tienda completa con una fila de cada entidad referenciable. */
export async function seedStore(tag: string): Promise<Seed> {
  const n = next();
  const store = await prisma.store.create({ data: { name: `Tienda ${tag}`, phone: `S${n}`, code: generateStoreCode() } });
  const storeId = store.id;
  const [user, customer, category, supplier] = await Promise.all([
    prisma.user.create({
      data: { storeId, name: `Dueño ${tag}`, phone: `U${n}`, pinHash: "x" },
    }),
    prisma.customer.create({ data: { storeId, name: `Cliente ${tag}` } }),
    prisma.category.create({ data: { storeId, name: `Cat ${tag}` } }),
    prisma.supplier.create({ data: { storeId, name: `Prov ${tag}` } }),
  ]);
  const product = await prisma.product.create({
    data: { storeId, name: `Producto ${tag}`, salePrice: "1000", categoryId: category.id },
  });
  const sale = await prisma.sale.create({
    data: { storeId, paymentType: "CASH", total: "1000", createdByUserId: user.id },
  });
  return {
    storeId,
    userId: user.id,
    customerId: customer.id,
    categoryId: category.id,
    supplierId: supplier.id,
    productId: product.id,
    saleId: sale.id,
  };
}

export async function seedTwoStores() {
  const [A, B] = await Promise.all([seedStore("A"), seedStore("B")]);
  return { A, B };
}

export interface DbRejection {
  name: string;
  code?: string;
  message: string;
}

/** Ejecuta la operación y devuelve el error; falla si la BD la dejó pasar. */
export async function rejection(op: PromiseLike<unknown>): Promise<DbRejection> {
  try {
    await op;
  } catch (e) {
    const err = e as { name?: string; code?: string; message?: string };
    return { name: err.name ?? "Error", code: err.code, message: err.message ?? String(e) };
  }
  throw new Error("Se esperaba que la BD rechazara la operación, pero fue aceptada.");
}
