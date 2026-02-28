/*
  Warnings:

  - You are about to drop the column `employee_type` on the `employees` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "employees_employee_type_idx";

-- AlterTable
ALTER TABLE "employees" DROP COLUMN "employee_type";

-- CreateIndex
CREATE INDEX "wage_rates_employee_id_effective_from_idx" ON "wage_rates"("employee_id", "effective_from");

-- CreateIndex
CREATE INDEX "wage_rates_position_id_effective_from_idx" ON "wage_rates"("position_id", "effective_from");
