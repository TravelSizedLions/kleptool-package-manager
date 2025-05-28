#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tsNodePath = resolve(__dirname, '../node_modules/.bin/ts-node');
const entryPath = resolve(__dirname, '../src/index.ts');

try {
  execFileSync(tsNodePath, ['--esm', entryPath, ...process.argv.slice(2)], { stdio: 'inherit' });
} catch (error) {
  process.exit(error.status || 1);
} 