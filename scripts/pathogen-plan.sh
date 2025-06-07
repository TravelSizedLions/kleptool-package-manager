#!/bin/bash

# Pathogen mutation planning script
# Generates mutations for TypeScript files using universalmutator

set -e

# Debug: Show PATH and search for mutate command
echo "🔍 Debugging universalmutator installation..."
echo "PATH: $PATH"
echo "Checking for mutate command:"
which mutate || echo "mutate command not found in PATH"
ls -la ~/.local/bin/mutate 2>/dev/null || echo "mutate not found in ~/.local/bin"
python3 -m universalmutator --help >/dev/null 2>&1 && echo "python3 -m universalmutator works" || echo "python3 -m universalmutator failed"

# Create mutations directory
mkdir -p .mutations/typescript

echo "🧬 Generating mutations..."

# Try multiple approaches to find and use universalmutator
if command -v mutate >/dev/null 2>&1; then
    echo "Using mutate command from PATH"
    find src/cli -name "*.ts" -not -name "*.spec.ts" | xargs -I {} mutate {} --mutantDir .mutations/typescript --noCheck
elif [ -f ~/.local/bin/mutate ]; then
    echo "Using mutate from ~/.local/bin"
    find src/cli -name "*.ts" -not -name "*.spec.ts" | xargs -I {} ~/.local/bin/mutate {} --mutantDir .mutations/typescript --noCheck
elif python3 -m universalmutator --help >/dev/null 2>&1; then
    echo "Using python3 -m universalmutator"
    find src/cli -name "*.ts" -not -name "*.spec.ts" | while read file; do
        python3 -m universalmutator "$file" --mutantDir .mutations/typescript --noCheck
    done
else
    echo "❌ ERROR: universalmutator not found! Tried:"
    echo "  - mutate command in PATH"
    echo "  - ~/.local/bin/mutate"
    echo "  - python3 -m universalmutator"
    exit 1
fi

# Count and report generated mutations
mutation_count=$(find .mutations/typescript -name "*.ts" | wc -l)
echo "✓ Generated $mutation_count mutations" 
