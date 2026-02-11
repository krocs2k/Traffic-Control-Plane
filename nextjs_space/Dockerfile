FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat wget
WORKDIR /build

# Copy package.json and generate a fresh yarn.lock
COPY package.json ./
RUN yarn install --frozen-lockfile || yarn install

# Rebuild the source code only when needed
FROM base AS builder
RUN apk add --no-cache wget
WORKDIR /build
COPY --from=deps /build/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build the application
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_OUTPUT_MODE=standalone
RUN yarn build

# Production image - use /srv/app to avoid any cached layer conflicts
FROM base AS runner
RUN apk add --no-cache wget

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Create fresh application directory
WORKDIR /srv/app

# Copy standalone output (excluding node_modules which is a symlink)
COPY --from=builder --chown=nextjs:nodejs /build/.next/standalone/server.js ./
COPY --from=builder --chown=nextjs:nodejs /build/.next/standalone/package.json ./
COPY --from=builder --chown=nextjs:nodejs /build/.next/standalone/.next ./.next

# Copy static files
COPY --from=builder --chown=nextjs:nodejs /build/.next/static ./.next/static

# Copy public folder
COPY --from=builder --chown=nextjs:nodejs /build/public ./public

# Copy prisma schema
COPY --from=builder --chown=nextjs:nodejs /build/prisma ./prisma

# Create node_modules and copy required modules
RUN mkdir -p ./node_modules/.prisma ./node_modules/@prisma ./node_modules/prisma ./node_modules/bcryptjs ./node_modules/.bin
COPY --from=builder --chown=nextjs:nodejs /build/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /build/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /build/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /build/node_modules/bcryptjs ./node_modules/bcryptjs

# Copy pre-compiled seed script
COPY --from=builder --chown=nextjs:nodejs /build/scripts/compiled ./scripts

# Copy entrypoint script
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Add node_modules/.bin to PATH
ENV PATH="/srv/app/node_modules/.bin:$PATH"

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
