-- =====================================================================
-- down.sql de 20261111120000_r2_auth_schema_autoria
-- Deshace la migración en orden inverso. NO lo ejecuta Prisma: se corre a mano
--   (prisma db execute --file ... --url <directa>) y solo con aprobación.
--
-- Límites honestos:
--   * Devolver "User.phone" a NOT NULL solo es posible si ningún usuario tiene phone NULL
--     (p. ej. empleados sin celular). Si los hay, se detiene con un mensaje y no cambia nada.
--   * Se pierden los datos escritos en columnas/tablas nuevas (usuarios/empleados, códigos, autoría
--     de anulaciones, RateLimit, AuthEvent). La autoría de creación (createdByUserId) NO se pierde:
--     vuelve a llamarse userId con sus mismos valores.
--   * Ningún dato original se modifica ni se borra.
-- Termina quitando el registro de la migración de _prisma_migrations, para que Prisma la vea pendiente.
-- =====================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User" WHERE "phone" IS NULL) THEN
    RAISE EXCEPTION 'down R2: hay usuarios sin celular (empleados). No se puede volver phone a NOT NULL sin decidir qué hacer con ellos.';
  END IF;
END $$;

-- 7. CHECK de autoría y anulación
ALTER TABLE "StockEntry" DROP CONSTRAINT "StockEntry_void_pair_chk";
ALTER TABLE "Payment"    DROP CONSTRAINT "Payment_void_pair_chk";
ALTER TABLE "Sale"       DROP CONSTRAINT "Sale_void_pair_chk";
ALTER TABLE "Payment"    DROP CONSTRAINT "Payment_created_by_required_chk";
ALTER TABLE "Sale"       DROP CONSTRAINT "Sale_created_by_required_chk";

-- 6. voidedByUserId
ALTER TABLE "StockEntry" DROP CONSTRAINT "StockEntry_voidedByUserId_storeId_fkey";
ALTER TABLE "Payment"    DROP CONSTRAINT "Payment_voidedByUserId_storeId_fkey";
ALTER TABLE "Sale"       DROP CONSTRAINT "Sale_voidedByUserId_storeId_fkey";
ALTER TABLE "StockEntry" DROP COLUMN "voidedByUserId";
ALTER TABLE "Payment"    DROP COLUMN "voidedByUserId";
ALTER TABLE "Sale"       DROP COLUMN "voidedByUserId";

-- 5. createdByUserId -> userId (mismos valores)
ALTER TABLE "Payment" RENAME CONSTRAINT "Payment_createdByUserId_storeId_fkey" TO "Payment_userId_storeId_fkey";
ALTER TABLE "Payment" RENAME COLUMN "createdByUserId" TO "userId";
ALTER TABLE "Sale" RENAME CONSTRAINT "Sale_createdByUserId_storeId_fkey" TO "Sale_userId_storeId_fkey";
ALTER TABLE "Sale" RENAME COLUMN "createdByUserId" TO "userId";

-- 4. Tablas nuevas
DROP TABLE "AuthEvent";
DROP TABLE "RateLimit";
DROP TYPE "AuthEventType";

-- 3. Store.code
ALTER TABLE "Store" DROP CONSTRAINT "Store_code_format_chk";
DROP INDEX "Store_code_key";
ALTER TABLE "Store" DROP COLUMN "code";

-- 2. User
ALTER TABLE "User" DROP CONSTRAINT "User_pinHashVersion_positive_chk";
ALTER TABLE "User" DROP CONSTRAINT "User_tokenVersion_nonneg_chk";
ALTER TABLE "User" DROP CONSTRAINT "User_username_format_chk";
ALTER TABLE "User" DROP CONSTRAINT "User_employee_requires_username_chk";
ALTER TABLE "User" DROP CONSTRAINT "User_owner_requires_phone_chk";
DROP INDEX "User_one_owner_per_store_idx";
DROP INDEX "User_storeId_username_key";
ALTER TABLE "User" ALTER COLUMN "phone" SET NOT NULL;
ALTER TABLE "User" DROP COLUMN "username",
DROP COLUMN "tokenVersion",
DROP COLUMN "pinHashVersion",
DROP COLUMN "pinChangedAt",
DROP COLUMN "mustChangePin",
DROP COLUMN "lastLoginAt",
DROP COLUMN "deactivatedAt";

-- Registro de la migración: Prisma volverá a verla como pendiente.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261111120000_r2_auth_schema_autoria';
