/*
  Warnings:

  - You are about to alter the column `ot_rate` on the `time_entries` table. The data in that column could be lost. The data in that column will be cast from `Integer` to `Decimal(3,1)`.

*/
-- AlterTable
ALTER TABLE "time_entries" ALTER COLUMN "end_time" DROP NOT NULL,
ALTER COLUMN "ot_rate" SET DEFAULT 0,
ALTER COLUMN "ot_rate" SET DATA TYPE DECIMAL(3,1);
