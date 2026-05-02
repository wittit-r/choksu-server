-- Step 1: Add status column to time_entries (TimeEntryStatus enum already exists)
ALTER TABLE "time_entries" ADD COLUMN "status" "TimeEntryStatus" NOT NULL DEFAULT 'DRAFT';

-- Step 2: Migrate LOCKED → FILLED in time_sheets
UPDATE "time_sheets" SET "status" = 'FILLED' WHERE "status" = 'LOCKED';

-- Step 3: Remove LOCKED from TimeSheetStatus enum (rename technique)
ALTER TABLE "time_sheets" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "TimeSheetStatus" RENAME TO "TimeSheetStatus_old";
CREATE TYPE "TimeSheetStatus" AS ENUM ('PENDING', 'FILLED');
ALTER TABLE "time_sheets" ALTER COLUMN "status" TYPE "TimeSheetStatus" USING "status"::text::"TimeSheetStatus";
ALTER TABLE "time_sheets" ALTER COLUMN "status" SET DEFAULT 'PENDING';
DROP TYPE "TimeSheetStatus_old";
