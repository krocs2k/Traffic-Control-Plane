#!/usr/bin/env node
// server.js v11 - Works even when deployment platform runs "node server.js"
const { spawn } = require('child_process');
const path = require('path');

console.log('');
console.log('========================================');
console.log('  TCP server.js v11 - 2026-02-12');
console.log('========================================');
console.log('');

const nextBin = path.join(__dirname, 'node_modules', 'next', 'dist', 'bin', 'next');

console.log('Starting Next.js via:', nextBin);

const child = spawn('node', [nextBin, 'start', '-p', process.env.PORT || '3000', '-H', '0.0.0.0'], {
  stdio: 'inherit',
  cwd: __dirname
});

child.on('error', (err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
