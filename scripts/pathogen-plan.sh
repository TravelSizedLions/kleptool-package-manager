#!/bin/bash

# Pathogen mutation planning script
# Generates mutations for TypeScript files using universalmutator

set -e

# Create mutations directory
mkdir -p .mutations/typescript

echo "🧬 Generating mutations..."

# Find all TypeScript files (excluding spec files) and generate mutations
find src/cli -name "*.ts" -not -name "*.spec.ts" | xargs -I {} mutate {} --mutantDir .mutations/typescript --noCheck > /dev/null 2>&1

# Count and report generated mutations
mutation_count=$(find .mutations/typescript -name "*.ts" | wc -l)
echo "✓ Generated $mutation_count mutations" 
