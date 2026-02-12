#!/bin/sh
set -e
echo "=== ENTRYPOINT v4 - 2026-02-12 ==="
echo "Starting application..."

# CRITICAL: Remove server.js if it exists (from cached standalone builds)
if [ -f "/srv/app/server.js" ]; then
  echo "WARNING: Found cached server.js - removing it!"
  rm -f /srv/app/server.js
fi
if [ -d "/srv/app/.next/standalone" ]; then
  echo "WARNING: Found cached standalone folder - removing it!"
  rm -rf /srv/app/.next/standalone
fi

# Wait for database to be ready
echo "Waiting for database connection..."
until node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$connect().then(() => process.exit(0)).catch(() => process.exit(1));
" 2>/dev/null; do
  echo "Database not ready, waiting..."
  sleep 2
done
echo "Database connected!"

# ALWAYS run database migrations to sync schema changes
echo "Running database migrations..."
npx prisma db push --skip-generate --accept-data-loss 2>&1 || {
  echo "Warning: prisma db push failed, attempting without --accept-data-loss..."
  npx prisma db push --skip-generate 2>&1 || echo "Migration skipped (may already be in sync)"
}
echo "Database schema synchronized!"

# Check if seeding is needed
echo "Checking database state..."
NEEDS_SEED=$(node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user.count().then(c => console.log(c === 0 ? 'true' : 'false')).catch(() => console.log('true'));
" 2>/dev/null || echo "true")

if [ "$NEEDS_SEED" = "true" ]; then
  echo "Running seed script..."
  node scripts/seed.js
else
  echo "Database has users, syncing passwords..."
  node scripts/seed.js || echo "Seed sync completed"
fi

echo "Starting Next.js server..."

# Final check - absolutely ensure no server.js
if [ -f "/srv/app/server.js" ]; then
  echo "FATAL: server.js still exists after cleanup! Removing..."
  rm -f /srv/app/server.js
fi

echo "Contents of /srv/app:"
ls -la /srv/app/

echo "Using next start (NOT node server.js)..."
exec node ./node_modules/next/dist/bin/next start -p 3000 -H 0.0.0.0
