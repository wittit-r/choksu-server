-- ย้ายข้อมูล PAID → CLOSED ก่อน (สำหรับข้อมูลเดิม)
UPDATE "pay_periods" SET "status" = 'CLOSED' WHERE "status" = 'PAID';

-- ลบค่า PAID ออกจาก enum (ใช้ rename technique)
BEGIN;
CREATE TYPE "PayPeriodStatus_new" AS ENUM ('OPEN', 'CLOSED');
ALTER TABLE "pay_periods" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "pay_periods" ALTER COLUMN "status" TYPE "PayPeriodStatus_new" USING ("status"::text::"PayPeriodStatus_new");
ALTER TYPE "PayPeriodStatus" RENAME TO "PayPeriodStatus_old";
ALTER TYPE "PayPeriodStatus_new" RENAME TO "PayPeriodStatus";
DROP TYPE "PayPeriodStatus_old";
ALTER TABLE "pay_periods" ALTER COLUMN "status" SET DEFAULT 'OPEN';
COMMIT;

-- ลบ column paid_date ออกจาก pay_periods
ALTER TABLE "pay_periods" DROP COLUMN "paid_date";
