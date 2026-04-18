/*
  Warnings:

  - You are about to drop the column `lock_flag` on the `time_entries` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "time_entries_lock_flag_idx";

-- AlterTable
ALTER TABLE "time_entries" DROP COLUMN "lock_flag";
