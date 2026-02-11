FROM node:20-alpine AS base

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

# Create a clean next.config.js for Docker (removes problematic experimental settings)
RUN cat > next.config.js << 'NEXTCONFIG'
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
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

# Verify next.config.js
RUN echo "=== next.config.js ===" && cat next.config.js

# Build the application
ENV NEXT_TELEMETRY_DISABLED=1
RUN yarn build

# Verify standalone output exists
RUN ls -la .next/standalone/ && ls -la .next/standalone/.next/

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

# Copy server files
COPY --from=builder --chown=nextjs:nodejs /build/.next/standalone/server.js ./
COPY --from=builder --chown=nextjs:nodejs /build/.next/standalone/package.json ./

# Copy .next build output
COPY --from=builder --chown=nextjs:nodejs /build/.next/standalone/.next ./.next

# Copy full node_modules from builder (includes 'next' and all dependencies)
COPY --from=builder --chown=nextjs:nodejs /build/node_modules ./node_modules

# Verify 'next' module exists
RUN ls -la ./node_modules/next/ && echo "✓ 'next' module found"

# Copy static assets
COPY --from=builder --chown=nextjs:nodejs /build/public ./public
COPY --from=builder --chown=nextjs:nodejs /build/.next/static ./.next/static

# Copy Prisma schema
COPY --from=builder --chown=nextjs:nodejs /build/prisma ./prisma

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
