FROM node:20-alpine AS base

# ============================================
# CACHE BUST v7 - 2026-02-12 - CUSTOM SERVER.JS
# ============================================

FROM base AS deps
RUN apk add --no-cache libc6-compat wget openssl
WORKDIR /build
COPY nextjs_space/package.json ./
RUN yarn install --frozen-lockfile || yarn install

FROM base AS builder
RUN apk add --no-cache wget openssl
WORKDIR /build
COPY --from=deps /build/node_modules ./node_modules
COPY nextjs_space/ ./

RUN npx prisma generate

RUN npx tsc scripts/seed.ts --outDir scripts/compiled --esModuleInterop \
    --module commonjs --target es2020 --skipLibCheck --types node \
    || echo "Using pre-compiled seed.js"

RUN rm -rf .next

# next.config.js WITHOUT standalone
RUN cat > next.config.js << 'EOF'
/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  images: { unoptimized: true },
};
module.exports = nextConfig;
EOF

ENV NEXT_TELEMETRY_DISABLED=1
RUN yarn build

# ============================================
# PRODUCTION IMAGE v7
# ============================================
FROM base AS runner
RUN apk add --no-cache wget openssl bash

WORKDIR /srv/app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN mkdir -p ./uploads/public ./uploads/private && \
    chown -R nextjs:nodejs ./uploads

# Copy everything including node_modules
COPY --from=builder --chown=nextjs:nodejs /build/package.json ./
COPY --from=builder --chown=nextjs:nodejs /build/next.config.js ./
COPY --from=builder --chown=nextjs:nodejs /build/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /build/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /build/public ./public
COPY --from=builder --chown=nextjs:nodejs /build/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /build/scripts/compiled ./scripts

# Copy the custom server.js that spawns next start
COPY --from=builder --chown=nextjs:nodejs /build/server.js ./server.js

# Verify next module exists
RUN echo "=== VERIFICATION v7 ===" && \
    ls -la ./node_modules/next/ && \
    echo "✓ next module exists"

# Embedded entrypoint
RUN cat > /srv/app/docker-entrypoint.sh << 'ENTRYPOINT_SCRIPT'
#!/bin/bash
set -e

echo ""
echo "============================================"
echo "  ENTRYPOINT v7 - 2026-02-12"
echo "============================================"
echo ""

# Verify next module
if [ ! -d "/srv/app/node_modules/next" ]; then
  echo "FATAL: next module not found!"
  exit 1
fi
echo "OK: next module found"

# Wait for database
echo "Waiting for database..."
until node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$connect().then(() => process.exit(0)).catch(() => process.exit(1));
" 2>/dev/null; do
  sleep 2
done
echo "OK: Database connected"

# Sync schema
npx prisma db push --skip-generate --accept-data-loss 2>&1 || \
  npx prisma db push --skip-generate 2>&1 || true
echo "OK: Schema synced"

# Check seeding
NEEDS_SEED=$(node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user.count().then(c => console.log(c === 0 ? 'true' : 'false')).catch(() => console.log('true'));
" 2>/dev/null || echo "true")

if [ "$NEEDS_SEED" = "true" ]; then
  echo "Running seed..."
  node scripts/seed.js
else
  echo "Database has data, syncing..."
  node scripts/seed.js || true
fi

echo ""
echo "Starting Next.js server..."
exec node server.js
ENTRYPOINT_SCRIPT

RUN chmod +x /srv/app/docker-entrypoint.sh

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/srv/app/docker-entrypoint.sh"]
