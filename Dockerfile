FROM node:20-alpine AS base

# ============================================
# CACHE BUST v5 - 2026-02-12 - FORCE REBUILD
# ============================================
ARG CACHE_DATE=2026-02-12-v5
RUN echo "Cache bust: ${CACHE_DATE}"

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat wget openssl
WORKDIR /build

# Copy package.json and install deps
COPY nextjs_space/package.json ./
RUN yarn install --frozen-lockfile || yarn install

# Rebuild the source code only when needed
FROM base AS builder
RUN apk add --no-cache wget openssl
WORKDIR /build
COPY --from=deps /build/node_modules ./node_modules
COPY nextjs_space/ ./

# Generate Prisma client
RUN npx prisma generate

# Pre-compile seed script
RUN npx tsc scripts/seed.ts --outDir scripts/compiled --esModuleInterop \
    --module commonjs --target es2020 --skipLibCheck --types node \
    || echo "Using pre-compiled seed.js"

# Clean any previous build artifacts
RUN rm -rf .next server.js

# Create next.config.js WITHOUT standalone
RUN cat > next.config.js << 'EOF'
/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  images: { unoptimized: true },
};
module.exports = nextConfig;
EOF

# Build the application
ENV NEXT_TELEMETRY_DISABLED=1
RUN yarn build

# Verify NO standalone output
RUN echo "Verifying build..." && \
    ls -la .next/ && \
    ! test -d .next/standalone && echo "✓ No standalone folder"

# ============================================
# PRODUCTION IMAGE - v5
# ============================================
FROM base AS runner
ARG CACHE_DATE=2026-02-12-v5
RUN apk add --no-cache wget openssl bash && \
    echo "Production runner v5: ${CACHE_DATE}"

WORKDIR /srv/app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Set environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV ENTRYPOINT_VERSION="v5-2026-02-12"

# Create uploads directory
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

# CRITICAL: Remove any server.js (from old standalone builds)
RUN rm -f ./server.js ./.next/standalone/server.js 2>/dev/null || true && \
    rm -rf ./.next/standalone 2>/dev/null || true

# Verify: NO server.js, YES next module
RUN echo "=== FINAL VERIFICATION v5 ===" && \
    ls -la ./ && \
    ! test -f ./server.js && echo "✓ No server.js" && \
    test -d ./node_modules/next && echo "✓ next module exists"

# Copy entrypoint - THIS MUST BE LAST to ensure it's not cached
COPY --chown=nextjs:nodejs nextjs_space/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh && cat docker-entrypoint.sh

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
