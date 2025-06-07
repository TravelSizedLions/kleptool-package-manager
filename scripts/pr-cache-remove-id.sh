#!/bin/bash

# Remove resolved ID from PR cache
# Usage: ./scripts/pr-cache-remove-id.sh <comment_id>

set -e

COMMENT_ID="$1"

if [[ -z "$COMMENT_ID" ]]; then
    echo "Usage: $0 <comment_id>"
    exit 1
fi

if [[ ! -f ".cursor/pr_cache.json" ]]; then
    echo "Error: .cursor/pr_cache.json not found"
    exit 1
fi

# Remove the ID from the unresolved array
jq --arg id "$COMMENT_ID" '.unresolved = (.unresolved | map(select(. != $id)))' .cursor/pr_cache.json > .cursor/pr_cache.json.tmp
mv .cursor/pr_cache.json.tmp .cursor/pr_cache.json

REMAINING=$(jq '.unresolved | length' .cursor/pr_cache.json)
echo "Removed $COMMENT_ID from cache. $REMAINING IDs remaining." 
