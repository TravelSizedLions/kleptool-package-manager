import type { BuildConfig } from 'bun';

const config: BuildConfig = {
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  target: 'bun',
  format: 'esm',
  splitting: false,
  sourcemap: 'external',
  minify: false, // Keep readable for debugging initially
  external: [
    // We'll need to bundle the Rust binaries separately
    'src/rust/target/release/**/*',
  ],
};

export default config;
