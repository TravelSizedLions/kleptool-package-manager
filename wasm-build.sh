#!/bin/bash
set -e

# Build the Rust WASM module
echo "Building Rust WASM module..."
cd src/rust/wasm_module
# Make sure wasm-pack is installed
# cargo install wasm-pack
wasm-pack build --target web --out-dir pkg

# Move back to the project root
cd ../../../

# TypeScript compilation is handled by your existing TS build process
echo "WASM build complete!"
echo "The WASM module is available at src/rust/wasm_module/pkg/"
echo "You can now import it in your TypeScript code" 