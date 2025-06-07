#!/bin/bash

set -e

# Usage: ./pr-commit.sh <thread-id> <commit-title> [additional-details] [--dry-run]
# Example: ./pr-commit.sh PRRT_kwDOOr2C4M5RrgHe "Fix mutation task naming" "Simplified from 3 tasks to 2 cleaner tasks"

if [ $# -lt 2 ]; then
    echo "Usage: $0 <thread-id> <commit-title> [additional-details] [--dry-run]"
    echo "Example: $0 PRRT_kwDOOr2C4M5RrgHe 'Fix mutation task naming' 'Simplified from 3 tasks to 2 cleaner tasks'"
    exit 1
fi

THREAD_ID="$1"
COMMIT_TITLE="$2"
ADDITIONAL_DETAILS="${3:-}"
DRY_RUN=false

# Check for --dry-run flag
for arg in "$@"; do
    if [ "$arg" = "--dry-run" ]; then
        DRY_RUN=true
        break
    fi
done

# Read PR info from cache
CACHE_FILE=".cursor/pr_cache.json"
if [ ! -f "$CACHE_FILE" ]; then
    echo "❌ Error: PR cache file not found at $CACHE_FILE"
    exit 1
fi

# Extract owner, repo, and PR number from cache using jq
OWNER=$(jq -r '.owner' "$CACHE_FILE")
REPO=$(jq -r '.repository' "$CACHE_FILE") 
PR_NUMBER=$(jq -r '.pr' "$CACHE_FILE")

if [ "$OWNER" = "null" ] || [ "$REPO" = "null" ] || [ "$PR_NUMBER" = "null" ]; then
    echo "❌ Error: Could not read owner, repository, or pr from cache file"
    exit 1
fi

# Get the first comment ID from the thread to construct the URL
FIRST_COMMENT_ID=$(jq -r --arg thread_id "$THREAD_ID" '.threads[] | select(.thread_id == $thread_id) | .comments[0].id' "$CACHE_FILE")

if [ "$FIRST_COMMENT_ID" = "null" ] || [ -z "$FIRST_COMMENT_ID" ]; then
    echo "❌ Error: Could not find comment ID for thread $THREAD_ID"
    exit 1
fi

# Convert GraphQL node ID to numeric database ID for URL
NUMERIC_ID=$(unset PAGER && gh api graphql -f query="query { node(id: \"$FIRST_COMMENT_ID\") { ... on PullRequestReviewComment { databaseId } } }" --jq '.data.node.databaseId' 2>/dev/null)

if [ "$NUMERIC_ID" = "null" ] || [ -z "$NUMERIC_ID" ]; then
    echo "❌ Error: Could not convert comment ID to numeric ID"
    exit 1
fi

# Construct the GitHub thread URL with proper format
THREAD_URL="https://github.com/${OWNER}/${REPO}/pull/${PR_NUMBER}#discussion_r${NUMERIC_ID}"

echo "🔧 Preparing commit for thread: $THREAD_ID"

# Add all untracked and modified files (unless dry run)
if [ "$DRY_RUN" = false ]; then
    git add -A
fi

# Check if there are any changes to commit
if [ "$DRY_RUN" = false ] && git diff --cached --quiet; then
    echo "⚠️  No changes detected, creating empty commit..."
    ALLOW_EMPTY="--allow-empty"
else
    echo "✅ Changes detected, proceeding with commit..."
    ALLOW_EMPTY=""
fi

# Build the commit message
COMMIT_MESSAGE="$COMMIT_TITLE"

# Combine additional details with thread info
DETAILS_SECTION=""
if [ -n "$ADDITIONAL_DETAILS" ]; then
    DETAILS_SECTION="$ADDITIONAL_DETAILS

"
fi

DETAILS_SECTION="${DETAILS_SECTION}Addresses: $THREAD_URL
Thread ID: $THREAD_ID"

COMMIT_MESSAGE="$COMMIT_MESSAGE

$DETAILS_SECTION"

# Create the commit or show dry run
echo "📝 Creating commit with message:"
echo "---"
echo "$COMMIT_MESSAGE"
echo "---"

if [ "$DRY_RUN" = true ]; then
    echo "🧪 DRY RUN - No commit created"
    echo "🔗 Thread URL: $THREAD_URL"
else
    git commit $ALLOW_EMPTY -m "$COMMIT_MESSAGE"
    echo "✅ Commit created successfully!"
    echo "🔗 Thread URL: $THREAD_URL"
fi 