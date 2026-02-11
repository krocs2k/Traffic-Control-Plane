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

# Package everything into tarballs to avoid Docker overlay conflicts
# Remove node_modules from standalone BEFORE tarring
RUN rm -rf /app/.next/standalone/node_modules && \
    cd /app/.next && tar czf /tmp/standalone.tar.gz standalone && \
    tar czf /tmp/static.tar.gz static && \
    cd /app && tar czf /tmp/prisma.tar.gz prisma && \
    cd /app && tar czf /tmp/public.tar.gz public && \
    mkdir -p /tmp/extra_modules && \
    cp -r /app/node_modules/.prisma /tmp/extra_modules/ && \
    cp -r /app/node_modules/@prisma /tmp/extra_modules/ && \
    cp -r /app/node_modules/prisma /tmp/extra_modules/ && \
    cp -r /app/node_modules/bcryptjs /tmp/extra_modules/ && \
    mkdir -p /tmp/extra_modules/.bin && \
    cp /app/node_modules/.bin/prisma /tmp/extra_modules/.bin/ 2>/dev/null || true && \
    cd /tmp && tar czf /tmp/extra_modules.tar.gz extra_modules && \
    rm -rf /tmp/extra_modules

# Production image, copy all the files and run next
FROM base AS runner
RUN apk add --no-cache wget
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy tarballs only - no directory conflicts possible
COPY --from=builder /tmp/standalone.tar.gz /tmp/
COPY --from=builder /tmp/static.tar.gz /tmp/
COPY --from=builder /tmp/prisma.tar.gz /tmp/
COPY --from=builder /tmp/public.tar.gz /tmp/
COPY --from=builder /tmp/extra_modules.tar.gz /tmp/

# Extract everything in a single layer
RUN cd /tmp && \
    tar xzf standalone.tar.gz && \
    mv standalone/* /app/ && \
    mkdir -p /app/.next && \
    tar xzf static.tar.gz -C /app/.next && \
    tar xzf prisma.tar.gz -C /app && \
    tar xzf public.tar.gz -C /app && \
    tar xzf extra_modules.tar.gz && \
    mkdir -p /app/node_modules && \
    cp -r extra_modules/* /app/node_modules/ && \
    chown -R nextjs:nodejs /app && \
    rm -rf /tmp/*

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
