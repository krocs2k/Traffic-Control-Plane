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

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy Prisma schema
COPY --from=builder /app/prisma ./prisma

# Copy additional node_modules (pre-staged to avoid conflicts)
COPY --from=builder /app/extra_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/extra_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/extra_modules/prisma ./node_modules/prisma
COPY --from=builder /app/extra_modules/bcryptjs ./node_modules/bcryptjs
COPY --from=builder /app/extra_modules/.bin ./node_modules/.bin

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
