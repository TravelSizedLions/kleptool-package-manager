#!/bin/bash

# Script to extract coverage percentages from LCOV files
# Outputs coverage percentages for TypeScript and Rust to GitHub Actions outputs
# Expects LCOV files at:
# - ./coverage/typescript/lcov.info
# - ./coverage/rust/lcov.info

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source common utilities
source "$SCRIPT_DIR/common.sh"

echo "📊 Extracting coverage percentages..."

# Validate required environment variables
validate_env_var "GITHUB_OUTPUT"

# Extract TypeScript coverage
extract_coverage_from_lcov "./coverage/typescript/lcov.info" "TypeScript"

# Extract Rust coverage  
extract_coverage_from_lcov "./coverage/rust/lcov.info" "Rust"

echo "🎉 Coverage extraction completed!" 