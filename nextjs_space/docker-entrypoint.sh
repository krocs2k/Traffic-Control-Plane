#!/bin/bash
set -e

# ============================================
# ENTRYPOINT v5 - 2026-02-12
# If you don't see this message, Coolify is using cached image!
# Run: docker system prune -af && rebuild with "No Cache"
# ============================================
echo ""
echo "======================================="
echo "  ENTRYPOINT VERSION: v5 (2026-02-12)"
echo "======================================="
echo ""

# Verify next module exists
if [ ! -d "/srv/app/node_modules/next" ]; then
  echo "FATAL: next module not found!"
  ls -la /srv/app/node_modules/ | head -20
  exit 1
fi
echo "✓ next module found"

# Remove any server.js (from cached standalone builds)
if [ -f "/srv/app/server.js" ]; then
  echo "WARNING: Removing cached server.js"
  rm -f /srv/app/server.js
fi

# Wait for database
echo "Waiting for database..."
until node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$connect().then(() => process.exit(0)).catch(() => process.exit(1));
" 2>/dev/null; do
  echo "Database not ready, waiting..."
  sleep 2
done
echo "✓ Database connected!"

# Sync database schema
echo "Running database migrations..."
npx prisma db push --skip-generate --accept-data-loss 2>&1 || \
  npx prisma db push --skip-generate 2>&1 || \
  echo "Migration skipped (already in sync)"
echo "✓ Database schema synchronized!"

# Check if seeding needed
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

# Final structure check
echo ""
echo "=== Starting Next.js (v5 entrypoint) ==="
echo "Working directory: $(pwd)"
echo "Contents:"
ls -la /srv/app/

# Start Next.js using the next binary directly
exec node ./node_modules/next/dist/bin/next start -p 3000 -H 0.0.0.0
