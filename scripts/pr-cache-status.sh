#!/bin/bash

# Show PR cache status and next thread to process
# Usage: ./scripts/pr-cache-status.sh

set -e

if [[ ! -f ".cursor/pr_cache.json" ]]; then
    echo "No cache found. Run pr-cache-init.sh first."
    exit 1
fi

OWNER=$(jq -r '.owner' .cursor/pr_cache.json)
REPO=$(jq -r '.repository' .cursor/pr_cache.json)
PR=$(jq -r '.pr' .cursor/pr_cache.json)
UNRESOLVED_COUNT=$(jq '.unresolved | length' .cursor/pr_cache.json)
CONTEXT_FETCHED=$(jq -r '.context_fetched' .cursor/pr_cache.json)

echo "PR Cache Status:"
echo "  Repository: $OWNER/$REPO"
echo "  PR Number: $PR"
echo "  Unresolved Threads: $UNRESOLVED_COUNT"
echo "  Context Fetched: $CONTEXT_FETCHED"
echo

if [[ "$UNRESOLVED_COUNT" -gt 0 ]]; then
    NEXT_THREAD_ID=$(jq -r '.unresolved[0]' .cursor/pr_cache.json)
    echo "Next unresolved thread ID: $NEXT_THREAD_ID"
    
    # Show the comments for this thread
    echo
    echo "Comments in this thread:"
    jq -r --arg thread_id "$NEXT_THREAD_ID" '.threads[] | select(.thread_id == $thread_id) | .comments[] | "  - " + .body + " (line " + (.line // "null" | tostring) + " in " + .path + ")"' .cursor/pr_cache.json
    
    echo
    echo "Diff context:"
    jq -r --arg thread_id "$NEXT_THREAD_ID" '.threads[] | select(.thread_id == $thread_id) | .comments[] | .diffHunk' .cursor/pr_cache.json | head -20
else
    echo "All threads resolved!"
fi 