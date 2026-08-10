/**
 * Schema-registry seed.
 *
 * Ensures the V0.9.2 ZIA KPI schema is registered and active. Without this row,
 * every submission that names its schema explicitly
 * (`{"schema_version": "0.9.2"}`) fails with `SCHEMA_NOT_FOUND`, because
 * SchemaService.getSchemaByVersion does an exact lookup with no fallback.
 * Submissions that omit the field only work by accident, via
 * getDefaultSchema()'s "most recent active" fallback.
 *
 * Idempotent — safe to run on every deploy. Runs as part of the migration task
 * (see Dockerfile.prisma.migrate) and via `npm run bootstrap` locally.
 *
 * Plain .mjs on purpose: the migration image installs no TypeScript runner and
 * runs in a private subnet, so `npx tsx` would need a network round trip.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const VERSION = "0.9.2";
const NAME = "CoalitionX Basic Set of KPIs v0.9.2";

// The schema document lives in the repo (and so in the migration image) — it
// used to be read from a gitignored .cursor/ path, which meant the seed could
// not run anywhere but the machine that happened to have that file.
const SCHEMA_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "seed-data/zia-kpi-basic-set-0.9.2.json",
);

const prisma = new PrismaClient();

async function main() {
  const raw = readFileSync(SCHEMA_PATH, "utf-8");
  // NB: the document's own top-level `version` field reads "0.9.0" and is
  // stale — `$id` and `_metadata.version` are both 0.9.2. The registry row is
  // keyed on the version the API contract uses, so do not "fix" this to 0.9.0.
  const schema = JSON.parse(raw);
  const checksum = createHash("sha256").update(raw).digest("hex");

  const existing = await prisma.schemaRegistry.findUnique({
    where: { version: VERSION },
    select: { id: true, isActive: true, checksum: true },
  });

  // V0.9.2 is the only version the validation layer implements (the Zod schemas
  // in lib/kpi/schema.ts), so it is the one active version.
  const deactivated = await prisma.schemaRegistry.updateMany({
    where: { isActive: true, version: { not: VERSION } },
    data: { isActive: false },
  });

  try {
    await prisma.schemaRegistry.upsert({
      where: { version: VERSION },
      update: { schema, checksum, isActive: true, name: NAME },
      create: { version: VERSION, schema, checksum, isActive: true, name: NAME },
    });
  } catch (error) {
    // P2002: another container seeded the row between our read and our write.
    // Same intended end state, so converge on it instead of failing the task.
    if (error?.code !== "P2002") throw error;
    await prisma.schemaRegistry.update({
      where: { version: VERSION },
      data: { schema, checksum, isActive: true, name: NAME },
    });
  }

  const action = !existing
    ? "created"
    : existing.checksum === checksum && existing.isActive
      ? "already up to date"
      : "updated";
  console.log(`Schema registry: ${VERSION} ${action} (active).`);
  if (deactivated.count > 0) {
    console.log(`Deactivated ${deactivated.count} older active version(s).`);
  }
}

main()
  .catch((error) => {
    console.error("Schema registry seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
