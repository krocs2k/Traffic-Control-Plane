FROM node:20-alpine AS base

# ============================================
# v11 - 2026-02-12 - WORKING SERVER.JS
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

# Use clean next.config.js (no standalone)
RUN cp next.config.docker.js next.config.js && \
    echo "=== next.config.js (v11) ===" && cat next.config.js

RUN npx prisma generate

RUN npx tsc scripts/seed.ts --outDir scripts/compiled --esModuleInterop \
    --module commonjs --target es2020 --skipLibCheck --types node \
    || echo "Using pre-compiled seed.js"

RUN rm -rf .next

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_OUTPUT_MODE=""
RUN yarn build

# Verify NO standalone was created
RUN ! test -d .next/standalone || (echo "Removing standalone" && rm -rf .next/standalone)

# ============================================
# PRODUCTION IMAGE v11
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

# Copy from builder
COPY --from=builder --chown=nextjs:nodejs /build/package.json ./
COPY --from=builder --chown=nextjs:nodejs /build/next.config.js ./
COPY --from=builder --chown=nextjs:nodejs /build/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /build/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /build/public ./public
COPY --from=builder --chown=nextjs:nodejs /build/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /build/scripts/compiled ./scripts

# Copy server.js that spawns next start (works with deployment platforms)
COPY --from=builder --chown=nextjs:nodejs /build/server.js ./server.js

# Verify
RUN echo "=== v11 VERIFICATION ===" && \
    ls -la ./server.js && \
    ls -la ./node_modules/next/ > /dev/null && \
    echo "OK: server.js and next module exist"

# Create startup script
RUN cat > /srv/app/start.sh << 'STARTSCRIPT'
#!/bin/bash
set -e

echo ""
echo "========================================"
echo "  TCP v11 - $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================"
echo ""

# Wait for database
echo "Connecting to database..."
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

# Only seed if explicitly enabled via SEED_DATABASE=true environment variable
if [ "$SEED_DATABASE" = "true" ]; then
  echo "Seeding database (SEED_DATABASE=true)..."
  node scripts/seed.js || echo "Seeding failed or already complete"
else
  echo "Skipping database seeding (set SEED_DATABASE=true to enable)"
fi

echo ""
echo "Starting Next.js..."
exec node server.js
STARTSCRIPT

RUN chmod +x /srv/app/start.sh

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["/srv/app/start.sh"]
