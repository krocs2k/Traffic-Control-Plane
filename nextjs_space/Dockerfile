FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat wget
WORKDIR /app

# Copy package.json and generate a fresh yarn.lock
COPY package.json ./
RUN yarn install --frozen-lockfile || yarn install

# Rebuild the source code only when needed
FROM base AS builder
RUN apk add --no-cache wget
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build the application
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_OUTPUT_MODE=standalone
RUN yarn build

# Prepare additional node_modules for runner stage
# This avoids conflicts with standalone's node_modules
RUN mkdir -p /app/extra_modules && \
    cp -r /app/node_modules/.prisma /app/extra_modules/ && \
    cp -r /app/node_modules/@prisma /app/extra_modules/ && \
    cp -r /app/node_modules/prisma /app/extra_modules/ && \
    cp -r /app/node_modules/bcryptjs /app/extra_modules/ && \
    mkdir -p /app/extra_modules/.bin && \
    cp -r /app/node_modules/.bin/prisma /app/extra_modules/.bin/ 2>/dev/null || true && \
    cp -r /app/node_modules/.bin/prisma.cmd /app/extra_modules/.bin/ 2>/dev/null || true

# Production image, copy all the files and run next
FROM base AS runner
RUN apk add --no-cache wget
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Copy standalone, static, prisma, and extra_modules to temp locations
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone /tmp/standalone
COPY --from=builder --chown=nextjs:nodejs /app/.next/static /tmp/static
COPY --from=builder /app/prisma /tmp/prisma
COPY --from=builder --chown=nextjs:nodejs /app/extra_modules /tmp/extra_modules

# Single RUN command to assemble everything - avoids Docker layer conflicts with node_modules
RUN cd /tmp/standalone && \
    for item in *; do [ "$item" != "node_modules" ] && cp -r "$item" /app/ 2>/dev/null || true; done && \
    for item in .*; do [ "$item" != "." ] && [ "$item" != ".." ] && [ "$item" != "node_modules" ] && cp -r "$item" /app/ 2>/dev/null || true; done && \
    rm -rf /app/node_modules 2>/dev/null || true && \
    mkdir -p /app/node_modules && \
    cp -r /tmp/extra_modules/. /app/node_modules/ && \
    cp -r /tmp/static /app/.next/static && \
    cp -r /tmp/prisma /app/prisma && \
    chown -R nextjs:nodejs /app/node_modules /app/.next /app/prisma && \
    rm -rf /tmp/standalone /tmp/static /tmp/prisma /tmp/extra_modules

# Add node_modules/.bin to PATH for prisma CLI access
ENV PATH="/app/node_modules/.bin:$PATH"

# Copy pre-compiled seed script
COPY --from=builder /app/scripts/compiled ./scripts

# Copy entrypoint script
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
