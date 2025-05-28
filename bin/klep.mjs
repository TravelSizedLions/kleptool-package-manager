#!/usr/bin/env node

// This is a wrapper script that uses ts-node programmatically
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, '../src/index.ts');

// Use the Node.js loader directly with the ts-node/esm loader
const child = spawn(
  'node', 
  [
    '--loader', 'ts-node/esm',
    '--experimental-specifier-resolution=node',
    scriptPath,
    ...process.argv.slice(2)
  ],
  { stdio: 'inherit' }
);

child.on('exit', (code) => {
  process.exit(code || 0);
}); 