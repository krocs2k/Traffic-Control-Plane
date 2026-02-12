// Custom server.js - Works with both standalone and full node_modules
const path = require('path');
const { execSync, spawn } = require('child_process');

console.log('');
console.log('============================================');
console.log('  SERVER.JS v7 - 2026-02-12');
console.log('============================================');
console.log('');

// Check if we have node_modules/next
const nextPath = path.join(__dirname, 'node_modules', 'next');
const nextBinPath = path.join(__dirname, 'node_modules', 'next', 'dist', 'bin', 'next');

try {
  require.resolve('next');
  console.log('✓ next module found via require.resolve');
} catch (e) {
  console.log('next not found via require.resolve, checking paths...');
  const fs = require('fs');
  
  if (fs.existsSync(nextPath)) {
    console.log('✓ next folder exists at:', nextPath);
  } else {
    console.log('✗ next folder NOT found at:', nextPath);
    console.log('');
    console.log('Directory contents:');
    console.log(fs.readdirSync(__dirname).join(', '));
    
    if (fs.existsSync(path.join(__dirname, 'node_modules'))) {
      console.log('');
      console.log('node_modules contents (first 20):');
      console.log(fs.readdirSync(path.join(__dirname, 'node_modules')).slice(0, 20).join(', '));
    }
    process.exit(1);
  }
}

// Use spawn to run next start
console.log('Starting Next.js via node_modules/next/dist/bin/next...');

const nextProcess = spawn('node', [
  nextBinPath,
  'start',
  '-p', process.env.PORT || '3000',
  '-H', process.env.HOSTNAME || '0.0.0.0'
], {
  stdio: 'inherit',
  cwd: __dirname,
  env: process.env
});

nextProcess.on('error', (err) => {
  console.error('Failed to start Next.js:', err);
  process.exit(1);
});

nextProcess.on('exit', (code) => {
  process.exit(code || 0);
});
