/*
  Warnings:

  - You are about to drop the column `expiresAt` on the `sessions` table. All the data in the column will be lost.
  - Added the required column `access_expires_at` to the `sessions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `refresh_expires_at` to the `sessions` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "sessions_expiresAt_idx";

-- AlterTable
ALTER TABLE "sessions" DROP COLUMN "expiresAt",
ADD COLUMN     "access_expires_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "refresh_expires_at" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "sessions_access_expires_at_idx" ON "sessions"("access_expires_at");

-- CreateIndex
CREATE INDEX "sessions_refresh_expires_at_idx" ON "sessions"("refresh_expires_at");
