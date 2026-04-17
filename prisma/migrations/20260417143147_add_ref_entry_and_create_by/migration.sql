-- AlterTable
ALTER TABLE "time_entries" ADD COLUMN     "create_by" INTEGER,
ADD COLUMN     "reference_entry_id" INTEGER;

-- CreateIndex
CREATE INDEX "time_entries_reference_entry_id_idx" ON "time_entries"("reference_entry_id");
