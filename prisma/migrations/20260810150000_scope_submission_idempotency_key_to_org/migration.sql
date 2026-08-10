-- An idempotency key is the caller's own reference, so it is unique per
-- organization rather than globally: two partners may legitimately pick the same
-- value, and with a global index the second one collided with the first
-- (surfacing as a duplicate-key error on a perfectly valid request).
--
-- The composite index is weaker than the one it replaces, so existing rows
-- cannot violate it.

-- DropIndex
DROP INDEX "submissions_idempotencyKey_key";

-- CreateIndex
CREATE UNIQUE INDEX "submissions_organizationId_idempotencyKey_key" ON "submissions"("organizationId", "idempotencyKey");
