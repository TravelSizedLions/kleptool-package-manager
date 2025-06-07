#!/bin/bash

# Initialize PR cache with unresolved comment IDs and their context
# Usage: ./scripts/pr-cache-init.sh <owner> <repo> <pr_number>

set -e

if [[ $# -ne 3 ]]; then
    echo "Usage: $0 <owner> <repo> <pr_number>"
    exit 1
fi

OWNER="$1"
REPO="$2"
PR="$3"

# Create .cursor directory if it doesn't exist
mkdir -p .cursor

echo "Fetching unresolved review comments for PR #$PR..."

# Get both unresolved IDs and full context in one GraphQL call
FULL_DATA=$(gh api graphql -f query='query($owner: String!, $repo: String!, $pr: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $pr) { reviewThreads(first: 50) { nodes { id isResolved comments(first: 10) { nodes { id body path line diffHunk } } } } } } }' -f owner="$OWNER" -f repo="$REPO" -F pr="$PR")

# Extract unresolved thread IDs 
UNRESOLVED_THREAD_IDS=$(echo "$FULL_DATA" | jq -r '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false) | .id')

# Create threads mapping - each thread ID maps to its comments
THREADS_WITH_COMMENTS=$(echo "$FULL_DATA" | jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false) | {thread_id: .id, comments: .comments.nodes}]')

# Convert thread IDs to JSON array
UNRESOLVED_ARRAY=$(echo "$UNRESOLVED_THREAD_IDS" | jq -R . | jq -s .)

# Create cache file
jq -n \
  --arg owner "$OWNER" \
  --arg repo "$REPO" \
  --arg pr "$PR" \
  --argjson unresolved "$UNRESOLVED_ARRAY" \
  --argjson threads "$THREADS_WITH_COMMENTS" \
  '{
    owner: $owner,
    repository: $repo,
    pr: $pr,
    unresolved: $unresolved,
    threads: $threads,
    context_fetched: true
  }' > .cursor/pr_cache.json

UNRESOLVED_COUNT=$(echo "$UNRESOLVED_ARRAY" | jq 'length')
echo "Cache initialized with $UNRESOLVED_COUNT unresolved threads"
echo "Cache saved to .cursor/pr_cache.json" 