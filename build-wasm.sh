#!/bin/bash
set -e

echo "Building Rust WebAssembly module..."

# Ensure we're in the right directory
cd "$(dirname "$0")"

# Check if wasm-pack is installed
if ! command -v wasm-pack &> /dev/null; then
    echo "wasm-pack not found! Please install it with:"
    echo "cargo install wasm-pack"
    exit 1
fi

# Build the WebAssembly module
cd src/rust/web-assembly
wasm-pack build --target web

echo ""
echo "WebAssembly build completed successfully!"
echo "The module is available at: src/rust/web-assembly/pkg/"
echo ""
echo "To use it in your TypeScript code, import it with:"
echo "import wasmBridge from './wasm-bridge.js';"
echo "" 