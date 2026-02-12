FROM node:20-alpine AS base

# Cache bust: 2026-02-12-v4 - Runtime server.js removal in entrypoint
# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat wget openssl
WORKDIR /build

# Copy package.json and generate a fresh yarn.lock
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

# Pre-compile seed script (tsx fails silently in Docker)
RUN npx tsc scripts/seed.ts --outDir scripts/compiled --esModuleInterop \
    --module commonjs --target es2020 --skipLibCheck --types node \
    || echo "Using pre-compiled seed.js"

# Clean any previous build artifacts to prevent standalone remnants
RUN rm -rf .next

# Create a clean next.config.js for Docker (NO standalone - use next start instead)
RUN cat > next.config.js << 'NEXTCONFIG'
/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: { unoptimized: true },
};
module.exports = nextConfig;
NEXTCONFIG

# Verify next.config.js has NO standalone
RUN echo "=== next.config.js ===" && cat next.config.js && \
    echo "=== Verifying no standalone in config ===" && \
    ! grep -q "standalone" next.config.js && echo "✓ No standalone in config"

# Build the application
ENV NEXT_TELEMETRY_DISABLED=1
RUN yarn build

# Verify build output exists and NO standalone folder
RUN ls -la .next/ && \
    echo "=== Checking for standalone (should NOT exist) ===" && \
    ! test -d .next/standalone && echo "✓ No standalone folder - correct!" || \
    (echo "ERROR: standalone folder exists!" && rm -rf .next/standalone && echo "Removed it")

# Production image - use /srv/app to avoid any cached layer conflicts
FROM base AS runner
RUN apk add --no-cache wget openssl bash

WORKDIR /srv/app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Set environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV PATH="/srv/app/node_modules/.bin:$PATH"

# Create uploads directory for local file storage
RUN mkdir -p ./uploads/public ./uploads/private && \
    chown -R nextjs:nodejs ./uploads

# Copy everything from builder (full app with node_modules)
COPY --from=builder --chown=nextjs:nodejs /build/package.json ./
COPY --from=builder --chown=nextjs:nodejs /build/next.config.js ./
COPY --from=builder --chown=nextjs:nodejs /build/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /build/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /build/public ./public
COPY --from=builder --chown=nextjs:nodejs /build/prisma ./prisma

# CRITICAL: Remove any server.js if it exists (from cached standalone builds)
RUN rm -f ./server.js && \
    rm -rf ./.next/standalone

# Verify structure - NO server.js should exist
RUN echo "=== Final structure ===" && ls -la ./ && \
    echo "=== .next contents ===" && ls -la ./.next/ && \
    echo "=== Verifying next module ===" && ls -la ./node_modules/next/ && \
    echo "=== Verifying NO server.js ===" && \
    ! test -f ./server.js && echo "✓ No server.js - will use next start" || \
    (echo "ERROR: server.js exists!" && exit 1)

# Copy compiled seed script
COPY --from=builder --chown=nextjs:nodejs /build/scripts/compiled ./scripts

# Copy entrypoint script
COPY nextjs_space/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Switch to non-root user
USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
