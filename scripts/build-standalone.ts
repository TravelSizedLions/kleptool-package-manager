#!/usr/bin/env bun

import { $ } from 'bun';
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';

const RUST_TARGET_DIR = 'src/rust/target/release';
const DIST_DIR = 'dist';
const RUST_BINARIES_DIR = join(DIST_DIR, 'rust-binaries');

console.log('🔧 Building standalone klep executable...');

// Step 1: Clean and prepare directories
console.log('📁 Preparing directories...');
if (existsSync(DIST_DIR)) {
  await $`rm -rf ${DIST_DIR}`;
}
mkdirSync(DIST_DIR, { recursive: true });
mkdirSync(RUST_BINARIES_DIR, { recursive: true });

// Step 2: Build Rust binaries
console.log('🦀 Building Rust binaries...');
await $`cd src/rust && cargo build --release`;

// Step 3: Copy Rust binaries to dist
console.log('📦 Copying Rust binaries...');
const rustBinaries = readdirSync(RUST_TARGET_DIR).filter(file => {
  const fullPath = join(RUST_TARGET_DIR, file);
  const stat = statSync(fullPath);
  // Look for executable files that match our pattern
  return stat.isFile() && 
         (file.startsWith('bin-') || file.includes('--')) &&
         !file.endsWith('.d') && 
         !file.endsWith('.pdb');
});

for (const binary of rustBinaries) {
  const srcPath = join(RUST_TARGET_DIR, binary);
  const destPath = join(RUST_BINARIES_DIR, binary);
  copyFileSync(srcPath, destPath);
  console.log(`  ✅ Copied ${binary}`);
}

// Step 4: Create TypeScript build that includes binary paths
console.log('🔨 Building TypeScript with Bun...');
const buildResult = await $`bun build src/index.ts --compile --outfile ${join(DIST_DIR, 'klep')} --target bun`.quiet();

if (buildResult.exitCode !== 0) {
  console.error('❌ Failed to build TypeScript executable');
  process.exit(1);
}

// Step 5: Make executable (Unix systems)
if (process.platform !== 'win32') {
  await $`chmod +x ${join(DIST_DIR, 'klep')}`;
}

console.log('✨ Standalone executable built successfully!');
console.log(`📦 Output: ${join(DIST_DIR, 'klep')}`);
console.log(`🦀 Rust binaries: ${RUST_BINARIES_DIR}`);
console.log('\n🚀 You can now distribute the entire dist/ folder as a standalone package!'); 