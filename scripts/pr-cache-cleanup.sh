#!/bin/bash

# Clean up PR cache when done
# Usage: ./scripts/pr-cache-cleanup.sh

set -e

if [[ ! -f ".cursor/pr_cache.json" ]]; then
    echo "No cache file found - nothing to clean up"
    exit 0
fi

REMAINING=$(jq '.unresolved | length' .cursor/pr_cache.json)

if [[ "$REMAINING" -gt 0 ]]; then
    echo "Warning: $REMAINING unresolved comments still remain. Are you sure you want to delete the cache? (y/N)"
    read -r response
    if [[ "$response" != "y" && "$response" != "Y" ]]; then
        echo "Cache cleanup cancelled"
        exit 0
    fi
fi

rm .cursor/pr_cache.json
echo "Cache cleaned up successfully" 
