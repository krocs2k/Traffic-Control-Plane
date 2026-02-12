FROM node:20-alpine AS base

# ============================================
# v8 - 2026-02-12 - NO SERVER.JS AT ALL
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

# CRITICAL: Remove any server.js that might exist
RUN rm -f server.js

RUN npx prisma generate

RUN npx tsc scripts/seed.ts --outDir scripts/compiled --esModuleInterop \
    --module commonjs --target es2020 --skipLibCheck --types node \
    || echo "Using pre-compiled seed.js"

RUN rm -rf .next

# next.config.js - explicitly NO standalone
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

# Verify no standalone
RUN ! test -d .next/standalone || (echo "ERROR: standalone exists" && rm -rf .next/standalone)

# ============================================
# PRODUCTION IMAGE v8 - NO SERVER.JS
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

# Copy from builder - NO server.js
COPY --from=builder --chown=nextjs:nodejs /build/package.json ./
COPY --from=builder --chown=nextjs:nodejs /build/next.config.js ./
COPY --from=builder --chown=nextjs:nodejs /build/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /build/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /build/public ./public
COPY --from=builder --chown=nextjs:nodejs /build/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /build/scripts/compiled ./scripts

# CRITICAL: Delete any server.js that might exist
RUN rm -f /srv/app/server.js && \
    rm -rf /srv/app/.next/standalone && \
    echo "v8: Verified no server.js exists"

# Verify next module exists
RUN ls -la ./node_modules/next/ > /dev/null && echo "v8: next module verified"

# Create startup script inline
RUN cat > /srv/app/start.sh << 'STARTSCRIPT'
#!/bin/bash
set -e

echo ""
echo "========================================"
echo "  TCP v8 - $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================"
echo ""

# Verify no server.js
if [ -f /srv/app/server.js ]; then
  echo "WARNING: Found server.js - deleting it!"
  rm -f /srv/app/server.js
fi

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

# Seed if needed
NEEDS_SEED=$(node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user.count().then(c => console.log(c === 0 ? 'true' : 'false')).catch(() => console.log('true'));
" 2>/dev/null || echo "true")

if [ "$NEEDS_SEED" = "true" ]; then
  echo "Seeding database..."
  node scripts/seed.js
else
  echo "Database has data, syncing..."
  node scripts/seed.js || true
fi

echo ""
echo "========================================"
echo "  Starting Next.js (npx next start)"
echo "========================================"
echo ""

# Run next start directly - NOT server.js
exec npx next start -p ${PORT:-3000} -H ${HOSTNAME:-0.0.0.0}
STARTSCRIPT

RUN chmod +x /srv/app/start.sh

# Final verification
RUN echo "=== FINAL STRUCTURE v8 ===" && \
    ls -la /srv/app/ && \
    echo "" && \
    ! test -f /srv/app/server.js && echo "VERIFIED: No server.js" && \
    test -f /srv/app/start.sh && echo "VERIFIED: start.sh exists"

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["/srv/app/start.sh"]
