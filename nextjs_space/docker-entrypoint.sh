#!/bin/sh
set -e
echo "Starting application..."

# Wait for database
until node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$connect().then(() => process.exit(0)).catch(() => process.exit(1));
" 2>/dev/null; do sleep 1; done

# Check if seeding needed
NEEDS_SEED=$(node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user.count().then(c => console.log(c === 0 ? 'true' : 'false')).catch(() => console.log('migrate'));
" 2>/dev/null || echo "migrate")

if [ "$NEEDS_SEED" = "migrate" ]; then
  npx prisma db push --skip-generate
  npx prisma db seed
elif [ "$NEEDS_SEED" = "true" ]; then
  npx prisma db seed
fi

exec node server.js
