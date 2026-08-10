#!/bin/sh
set -e

echo "🔄 Running database migrations..."
npx prisma migrate deploy --schema=prisma/schema.prisma

# Migrations create the schema_registries table; the seed puts the V0.9.2 row in
# it. Without that row, submissions that name their schema version explicitly
# fail with SCHEMA_NOT_FOUND. Idempotent, so it is safe on every start.
echo "🌱 Seeding schema registry..."
node prisma/seed.mjs

echo "✅ Migrations complete. Starting application..."
exec "$@"
