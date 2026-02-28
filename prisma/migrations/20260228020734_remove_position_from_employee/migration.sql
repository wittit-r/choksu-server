/*
  Warnings:

  - You are about to drop the column `position_id` on the `employees` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "employees" DROP CONSTRAINT "employees_position_id_fkey";

-- DropIndex
DROP INDEX "employees_position_id_idx";

-- AlterTable
ALTER TABLE "employees" DROP COLUMN "position_id";
