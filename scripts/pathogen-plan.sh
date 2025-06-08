#!/bin/bash

# Pathogen mutation planning script
# Generates mutations for TypeScript files using universalmutator

set -e

source ./scripts/common.sh

# Create mutations directory
mkdir -p .mutations/typescript

log "Generating mutations..." 1

# Try multiple approaches to find and use universalmutator (silenced output)
if command -v mutate >/dev/null 2>&1; then
    find src/cli -name "*.ts" -not -name "*.spec.ts" | xargs -I {} mutate {} --mutantDir .mutations/typescript --noCheck >/dev/null 2>&1
elif [ -f ~/.local/bin/mutate ]; then
    find src/cli -name "*.ts" -not -name "*.spec.ts" | xargs -I {} ~/.local/bin/mutate {} --mutantDir .mutations/typescript --noCheck >/dev/null 2>&1
elif python3 -m universalmutator --help >/dev/null 2>&1; then
    find src/cli -name "*.ts" -not -name "*.spec.ts" | while read file; do
        python3 -m universalmutator "$file" --mutantDir .mutations/typescript --noCheck >/dev/null 2>&1
    done
else
    log_error "universalmutator not found!"
    exit 1
fi
