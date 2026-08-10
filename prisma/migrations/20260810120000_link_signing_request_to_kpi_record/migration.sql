-- AlterTable
ALTER TABLE "signing_requests" ADD COLUMN     "kpiRecordId" TEXT;

-- CreateIndex
CREATE INDEX "signing_requests_kpiRecordId_idx" ON "signing_requests"("kpiRecordId");

-- Backfill: link existing requests to the KPI record they signed. The request
-- payload's metadata.transaction_id is the submission id, or the KpiRecord id
-- when the record has no submission (KpiSigningService.signSubmittedKpis).
UPDATE "signing_requests" sr
SET "kpiRecordId" = kr."id"
FROM "kpi_records" kr
WHERE sr."kpiRecordId" IS NULL
  AND kr."assetId" = sr."assetId"
  AND kr."submissionId" = sr."requestPayload" -> 'metadata' ->> 'transaction_id';

UPDATE "signing_requests" sr
SET "kpiRecordId" = kr."id"
FROM "kpi_records" kr
WHERE sr."kpiRecordId" IS NULL
  AND kr."assetId" = sr."assetId"
  AND kr."id" = sr."requestPayload" -> 'metadata' ->> 'transaction_id';
