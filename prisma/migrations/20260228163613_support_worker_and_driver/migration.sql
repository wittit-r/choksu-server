/*
  Warnings:

  - A unique constraint covering the columns `[employee_id,month_period]` on the table `time_sheets` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "TimeSheetType" AS ENUM ('DAILY', 'MONTHLY');

-- DropForeignKey
ALTER TABLE "employees" DROP CONSTRAINT "employees_work_leader_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_work_leader_id_fkey";

-- DropForeignKey
ALTER TABLE "time_sheets" DROP CONSTRAINT "time_sheets_work_leader_id_fkey";

-- AlterTable
ALTER TABLE "employees" ALTER COLUMN "work_leader_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "employee_id" INTEGER,
ALTER COLUMN "work_leader_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "time_sheets" ADD COLUMN     "employee_id" INTEGER,
ADD COLUMN     "files" JSONB,
ADD COLUMN     "month_period" TEXT,
ADD COLUMN     "sheet_type" "TimeSheetType" NOT NULL DEFAULT 'DAILY',
ALTER COLUMN "work_leader_id" DROP NOT NULL,
ALTER COLUMN "work_date" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "invoices_employee_id_idx" ON "invoices"("employee_id");

-- CreateIndex
CREATE INDEX "time_sheets_employee_id_idx" ON "time_sheets"("employee_id");

-- CreateIndex
CREATE INDEX "time_sheets_month_period_idx" ON "time_sheets"("month_period");

-- CreateIndex
CREATE INDEX "time_sheets_sheet_type_idx" ON "time_sheets"("sheet_type");

-- CreateIndex
CREATE UNIQUE INDEX "time_sheets_employee_id_month_period_key" ON "time_sheets"("employee_id", "month_period");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_work_leader_id_fkey" FOREIGN KEY ("work_leader_id") REFERENCES "work_leaders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_work_leader_id_fkey" FOREIGN KEY ("work_leader_id") REFERENCES "work_leaders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_sheets" ADD CONSTRAINT "time_sheets_work_leader_id_fkey" FOREIGN KEY ("work_leader_id") REFERENCES "work_leaders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_sheets" ADD CONSTRAINT "time_sheets_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
