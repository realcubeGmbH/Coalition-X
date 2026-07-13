-- AlterTable
ALTER TABLE "users" ADD COLUMN     "did" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_did_key" ON "users"("did");

