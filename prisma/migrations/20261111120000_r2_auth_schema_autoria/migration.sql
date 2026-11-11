-- =====================================================================
-- R2 paso 1: modelo de autenticación, autoría y anulación
-- (docs/R2-AUTENTICACION.md §2 y §7).
--
-- Base generada con `prisma migrate diff` y EDITADA A MANO:
--   * Prisma proponía DROP COLUMN "userId" + ADD COLUMN "createdByUserId" (perdería la autoría).
--     Aquí es RENAME COLUMN + RENAME CONSTRAINT de la FK compuesta: no se pierde ningún dato.
--   * Verificaciones previas que DETIENEN la migración en vez de corregir por su cuenta.
--   * Relleno de Store.code idempotente y verificado.
--   * CHECK de autoría y de anulación.
-- Reversible con down.sql (misma carpeta; no se ejecuta solo).
-- Todo corre dentro de la transacción implícita del script: si algo falla, no queda nada a medias.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Verificaciones previas (no modifican nada)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Store" s
    WHERE (SELECT count(*) FROM "User" u WHERE u."storeId" = s.id AND u."role" = 'OWNER') <> 1
  ) THEN
    RAISE EXCEPTION 'R2: hay tiendas sin exactamente un OWNER. Corrígelo a mano antes de migrar (no se elige por su cuenta).';
  END IF;

  IF EXISTS (SELECT 1 FROM "User" WHERE "role" <> 'OWNER') THEN
    RAISE EXCEPTION 'R2: hay usuarios que no son OWNER y todavía no tienen usuario de empleado. Revisar a mano antes de migrar.';
  END IF;

  IF EXISTS (SELECT 1 FROM "User" WHERE "phone" IS NULL) THEN
    RAISE EXCEPTION 'R2: hay usuarios sin celular; un OWNER debe tenerlo.';
  END IF;

  -- La columna userId de Sale/Payment solo puede estar en la FK compuesta: si hubiera un índice
  -- u otro objeto que la use, el renombre debe contemplarlo explícitamente.
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename IN ('Sale', 'Payment') AND indexdef LIKE '%"userId"%'
  ) THEN
    RAISE EXCEPTION 'R2: existe un índice sobre userId en Sale/Payment; hay que renombrarlo en esta migración.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. User: columnas nuevas, phone opcional, CHECK e índice parcial
-- ---------------------------------------------------------------------
-- Los usuarios existentes ya son OWNER; tokenVersion queda en 0 por el DEFAULT. Nada se borra.
ALTER TABLE "User" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "mustChangePin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pinChangedAt" TIMESTAMP(3),
ADD COLUMN     "pinHashVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "username" TEXT,
ALTER COLUMN "phone" DROP NOT NULL;

CREATE UNIQUE INDEX "User_storeId_username_key" ON "User"("storeId", "username");

-- Exactamente un OWNER por tienda (Prisma no modela índices parciales).
CREATE UNIQUE INDEX "User_one_owner_per_store_idx" ON "User"("storeId") WHERE "role" = 'OWNER';

ALTER TABLE "User" ADD CONSTRAINT "User_owner_requires_phone_chk" CHECK ("role" <> 'OWNER' OR "phone" IS NOT NULL);
ALTER TABLE "User" ADD CONSTRAINT "User_employee_requires_username_chk" CHECK ("role" <> 'EMPLOYEE' OR "username" IS NOT NULL);
ALTER TABLE "User" ADD CONSTRAINT "User_username_format_chk" CHECK ("username" IS NULL OR "username" ~ '^[a-z0-9._]{3,20}$');
ALTER TABLE "User" ADD CONSTRAINT "User_tokenVersion_nonneg_chk" CHECK ("tokenVersion" >= 0);
ALTER TABLE "User" ADD CONSTRAINT "User_pinHashVersion_positive_chk" CHECK ("pinHashVersion" >= 1);

-- ---------------------------------------------------------------------
-- 3. Store.code: columna nullable -> relleno idempotente -> verificación -> NOT NULL + UNIQUE + CHECK
-- ---------------------------------------------------------------------
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "code" TEXT;

-- Relleno: 6 caracteres de 23456789ABCDEFGHJKMNPQRSTVWXYZ (30 símbolos; sin 0 O 1 I L U).
-- Solo toca filas con code NULL, así que repetirlo no cambia los códigos ya asignados.
-- random() de Postgres basta aquí: el código identifica la tienda, no es un secreto (la app genera los
-- nuevos con crypto.randomInt).
DO $$
DECLARE
  r RECORD;
  candidate TEXT;
  attempts INT;
  i INT;
  alphabet CONSTANT TEXT := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
BEGIN
  FOR r IN SELECT "id" FROM "Store" WHERE "code" IS NULL ORDER BY "createdAt", "id" LOOP
    attempts := 0;
    LOOP
      attempts := attempts + 1;
      IF attempts > 100 THEN
        RAISE EXCEPTION 'R2: no se pudo generar un código de tienda único tras 100 intentos';
      END IF;
      candidate := '';
      FOR i IN 1..6 LOOP
        candidate := candidate || substr(alphabet, 1 + floor(random() * 30)::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "Store" WHERE "code" = candidate);
    END LOOP;
    UPDATE "Store" SET "code" = candidate WHERE "id" = r."id";
  END LOOP;
END $$;

-- Verificación: ninguno nulo, todos de 6 caracteres válidos, todos distintos.
DO $$
DECLARE
  total INT;
  validos INT;
  distintos INT;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE "code" ~ '^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$'),
         count(DISTINCT "code")
    INTO total, validos, distintos
    FROM "Store";
  IF validos <> total OR distintos <> total THEN
    RAISE EXCEPTION 'R2: relleno de Store.code inválido (total %, válidos %, distintos %)', total, validos, distintos;
  END IF;
END $$;

ALTER TABLE "Store" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "Store_code_key" ON "Store"("code");
ALTER TABLE "Store" ADD CONSTRAINT "Store_code_format_chk" CHECK ("code" ~ '^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$');

-- ---------------------------------------------------------------------
-- 4. Tablas nuevas: RateLimit y AuthEvent
-- ---------------------------------------------------------------------
CREATE TYPE "AuthEventType" AS ENUM ('LOGIN_OK', 'LOGIN_FAIL', 'LOGIN_LOCKED', 'LOGOUT', 'PIN_CHANGED', 'PIN_RESET_BY_OWNER', 'SESSIONS_REVOKED', 'EMPLOYEE_CREATED', 'EMPLOYEE_DEACTIVATED', 'EMPLOYEE_REACTIVATED', 'STORE_REGISTERED');

CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "fails" INTEGER NOT NULL DEFAULT 0,
    "strikes" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "AuthEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "AuthEventType" NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "storeId" TEXT,
    "userId" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "meta" JSONB,

    CONSTRAINT "AuthEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RateLimit_updatedAt_idx" ON "RateLimit"("updatedAt");
CREATE INDEX "AuthEvent_storeId_createdAt_idx" ON "AuthEvent"("storeId", "createdAt");
CREATE INDEX "AuthEvent_userId_type_createdAt_idx" ON "AuthEvent"("userId", "type", "createdAt");
CREATE INDEX "AuthEvent_createdAt_idx" ON "AuthEvent"("createdAt");

-- ---------------------------------------------------------------------
-- 5. Autoría: userId -> createdByUserId (RENAME, nunca drop + add)
-- ---------------------------------------------------------------------
-- La FK compuesta (userId, storeId) -> User(id, storeId) sigue la columna renombrada; solo se renombra
-- su nombre para que coincida con el que Prisma espera y `migrate diff` posterior salga vacío.
ALTER TABLE "Sale" RENAME COLUMN "userId" TO "createdByUserId";
ALTER TABLE "Sale" RENAME CONSTRAINT "Sale_userId_storeId_fkey" TO "Sale_createdByUserId_storeId_fkey";

ALTER TABLE "Payment" RENAME COLUMN "userId" TO "createdByUserId";
ALTER TABLE "Payment" RENAME CONSTRAINT "Payment_userId_storeId_fkey" TO "Payment_createdByUserId_storeId_fkey";

-- ---------------------------------------------------------------------
-- 6. Quién anuló: voidedByUserId (+ FK compuesta, igual que R1)
-- ---------------------------------------------------------------------
ALTER TABLE "Sale"       ADD COLUMN "voidedByUserId" TEXT;
ALTER TABLE "Payment"    ADD COLUMN "voidedByUserId" TEXT;
ALTER TABLE "StockEntry" ADD COLUMN "voidedByUserId" TEXT;

ALTER TABLE "Sale"       ADD CONSTRAINT "Sale_voidedByUserId_storeId_fkey"       FOREIGN KEY ("voidedByUserId", "storeId") REFERENCES "User"("id", "storeId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Payment"    ADD CONSTRAINT "Payment_voidedByUserId_storeId_fkey"    FOREIGN KEY ("voidedByUserId", "storeId") REFERENCES "User"("id", "storeId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_voidedByUserId_storeId_fkey" FOREIGN KEY ("voidedByUserId", "storeId") REFERENCES "User"("id", "storeId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------
-- 7. CHECK de autoría y de anulación: NOT VALID = solo exigen cumplirlo a filas nuevas o modificadas.
--    El histórico (autor NULL, anulaciones sin quién) no se toca ni se inventa.
-- ---------------------------------------------------------------------
ALTER TABLE "Sale"    ADD CONSTRAINT "Sale_created_by_required_chk"    CHECK ("createdByUserId" IS NOT NULL) NOT VALID;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_created_by_required_chk" CHECK ("createdByUserId" IS NOT NULL) NOT VALID;

ALTER TABLE "Sale"       ADD CONSTRAINT "Sale_void_pair_chk"       CHECK (("voidedAt" IS NULL) = ("voidedByUserId" IS NULL)) NOT VALID;
ALTER TABLE "Payment"    ADD CONSTRAINT "Payment_void_pair_chk"    CHECK (("voidedAt" IS NULL) = ("voidedByUserId" IS NULL)) NOT VALID;
ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_void_pair_chk" CHECK (("voidedAt" IS NULL) = ("voidedByUserId" IS NULL)) NOT VALID;
