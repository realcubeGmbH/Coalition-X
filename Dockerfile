FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies based on package-lock.json
COPY package.json package-lock.json ./
# Copy prisma directory for client generation
COPY prisma ./prisma/

RUN npm ci
# Generate prisma client in deps stage (using custom config)
# Provide a dummy DATABASE_URL for generate (it doesn't actually connect)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npx prisma generate --config prisma/prisma.config.ts

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
# Copy the generated Prisma client
COPY --from=deps /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma
COPY . .

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
# Uncomment the following line in case you want to disable telemetry during runtime.
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy Prisma schema + migrations for `prisma migrate deploy` (ECS migration task)
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
# Copy the FULL node_modules (not a cherry-picked subset) so the Prisma CLI and
# all of its transitive deps (e.g. effect, @prisma/config, @prisma/engines) are
# present and `prisma migrate deploy` runs fully offline in the private subnets.
# Placed after the standalone copy so it supersedes Next's trimmed node_modules.
# Trade-off: larger image, but the migration task is reliable across Prisma upgrades.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Trust the Coalition-X internal CA. The Trust Layer (C3) is reachable only
# inside the VPC, so no public CA can issue for its name; it presents a
# certificate from this CA instead. A CA certificate is public data — the
# private key lives in Secrets Manager and never ships in an image.
COPY --chown=nextjs:nodejs certs/coalition-x-internal-ca.pem /app/certs/coalition-x-internal-ca.pem
ENV NODE_EXTRA_CA_CERTS=/app/certs/coalition-x-internal-ca.pem

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/config/next-config-js/output
CMD ["node", "server.js"]

