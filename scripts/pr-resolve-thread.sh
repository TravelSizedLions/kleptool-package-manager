#!/bin/bash

# Resolve a PR review thread and remove it from cache
# Usage: ./scripts/pr-resolve-thread.sh <thread_id> [optional_comment]

set -e

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <thread_id> [optional_comment]"
    exit 1
fi

THREAD_ID="$1"
COMMENT="${2:-Thread resolved}"

if [[ ! -f ".cursor/pr_cache.json" ]]; then
    echo "Error: .cursor/pr_cache.json not found. Run pr-cache-init.sh first."
    exit 1
fi

echo "Resolving thread: $THREAD_ID"

# Use GraphQL mutation to resolve the thread
gh api graphql -f query='
mutation($threadId: ID!) {
  resolveReviewThread(input: {threadId: $threadId}) {
    thread {
      id
      isResolved
    }
  }
}' -f threadId="$THREAD_ID"

if [[ $? -eq 0 ]]; then
    echo "Thread resolved successfully"
    
    # Remove the thread ID from cache
    ./scripts/pr-cache-remove-id.sh "$THREAD_ID"
    
    echo "Thread $THREAD_ID marked as resolved and removed from cache"
else
    echo "Failed to resolve thread $THREAD_ID"
    exit 1
fi 