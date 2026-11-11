-- DropForeignKey
ALTER TABLE "CashClosing" DROP CONSTRAINT "CashClosing_userId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_userId_fkey";

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "Sale" DROP CONSTRAINT "Sale_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Sale" DROP CONSTRAINT "Sale_userId_fkey";

-- DropForeignKey
ALTER TABLE "SaleItem" DROP CONSTRAINT "SaleItem_productId_fkey";

-- DropForeignKey
ALTER TABLE "SaleItem" DROP CONSTRAINT "SaleItem_saleId_fkey";

-- DropForeignKey
ALTER TABLE "StockEntry" DROP CONSTRAINT "StockEntry_productId_fkey";

-- DropForeignKey
ALTER TABLE "StockEntry" DROP CONSTRAINT "StockEntry_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierDebt" DROP CONSTRAINT "SupplierDebt_supplierId_fkey";

-- DropIndex
DROP INDEX "CashClosing_clientId_key";

-- DropIndex
DROP INDEX "Customer_clientId_key";

-- DropIndex
DROP INDEX "Payment_clientId_key";

-- DropIndex
DROP INDEX "Product_clientId_key";

-- DropIndex
DROP INDEX "Sale_clientId_key";

-- DropIndex
DROP INDEX "StockEntry_clientId_key";

-- AlterTable: SaleItem.storeId (columna nueva): nullable -> relleno desde Sale -> NOT NULL.
-- En dev/pruebas SaleItem tiene 0 filas; el relleno cubre cualquier fila existente.
ALTER TABLE "SaleItem" ADD COLUMN "storeId" TEXT;

UPDATE "SaleItem" AS i SET "storeId" = s."storeId" FROM "Sale" AS s WHERE s."id" = i."saleId";

ALTER TABLE "SaleItem" ALTER COLUMN "storeId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "CashClosing_storeId_clientId_key" ON "CashClosing"("storeId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_id_storeId_key" ON "Category"("id", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_id_storeId_key" ON "Customer"("id", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_storeId_clientId_key" ON "Customer"("storeId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_storeId_clientId_key" ON "Payment"("storeId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_id_storeId_key" ON "Product"("id", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_storeId_clientId_key" ON "Product"("storeId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_id_storeId_key" ON "Sale"("id", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_storeId_clientId_key" ON "Sale"("storeId", "clientId");

-- CreateIndex
CREATE INDEX "SaleItem_storeId_saleId_idx" ON "SaleItem"("storeId", "saleId");

-- CreateIndex
CREATE UNIQUE INDEX "StockEntry_storeId_clientId_key" ON "StockEntry"("storeId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_id_storeId_key" ON "Supplier"("id", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "User_id_storeId_key" ON "User"("id", "storeId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_storeId_fkey" FOREIGN KEY ("customerId", "storeId") REFERENCES "Customer"("id", "storeId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_storeId_fkey" FOREIGN KEY ("userId", "storeId") REFERENCES "User"("id", "storeId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_storeId_fkey" FOREIGN KEY ("categoryId", "storeId") REFERENCES "Category"("id", "storeId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_productId_storeId_fkey" FOREIGN KEY ("productId", "storeId") REFERENCES "Product"("id", "storeId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StockEntry" ADD CONSTRAINT "StockEntry_supplierId_storeId_fkey" FOREIGN KEY ("supplierId", "storeId") REFERENCES "Supplier"("id", "storeId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_userId_storeId_fkey" FOREIGN KEY ("userId", "storeId") REFERENCES "User"("id", "storeId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerId_storeId_fkey" FOREIGN KEY ("customerId", "storeId") REFERENCES "Customer"("id", "storeId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_storeId_fkey" FOREIGN KEY ("saleId", "storeId") REFERENCES "Sale"("id", "storeId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_productId_storeId_fkey" FOREIGN KEY ("productId", "storeId") REFERENCES "Product"("id", "storeId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CashClosing" ADD CONSTRAINT "CashClosing_userId_storeId_fkey" FOREIGN KEY ("userId", "storeId") REFERENCES "User"("id", "storeId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SupplierDebt" ADD CONSTRAINT "SupplierDebt_supplierId_storeId_fkey" FOREIGN KEY ("supplierId", "storeId") REFERENCES "Supplier"("id", "storeId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- CHECK constraints (no los expresa Prisma; se mantienen a mano)
-- Un fiado siempre tiene cliente.
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_credit_requires_customer_chk" CHECK ("paymentType" <> 'CREDIT' OR "customerId" IS NOT NULL);

ALTER TABLE "Sale" ADD CONSTRAINT "Sale_total_positive_chk" CHECK ("total" > 0);

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive_chk" CHECK ("amount" > 0);

ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_quantity_positive_chk" CHECK ("quantity" > 0);
