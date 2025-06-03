#!/bin/bash

# Script to create or update coverage badges using GitHub Gists and Shields.io
# Expects the following environment variables:
# - GITHUB_TOKEN: GitHub token for API access
# - GIST_ID: (optional) Existing gist ID to update
# - TS_COVERAGE: TypeScript coverage percentage (e.g., "85.3%")
# - RUST_COVERAGE: Rust coverage percentage (e.g., "92.1%")

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source common utilities
source "$SCRIPT_DIR/common.sh"

# Create badge JSON content
create_badge_json() {
  local label=$1
  local message=$2
  local color=$3
  local logo=$4
  
  cat << EOF
{
  "schemaVersion": 1,
  "label": "$label",
  "message": "$message",
  "color": "$color",
  "namedLogo": "$logo"
}
EOF
}

# Validate required environment variables
validate_env_vars "GITHUB_TOKEN" "TS_COVERAGE" "RUST_COVERAGE"

log_step "Updating coverage badges..."
log_info "TypeScript coverage: $TS_COVERAGE"
log_info "Rust coverage: $RUST_COVERAGE"

# Create or update gist
if [[ -z "${GIST_ID:-}" ]]; then
  log_step "Creating new gist for badges..."
  
  # Create TypeScript badge JSON
  TS_COLOR=$(get_badge_color "$TS_COVERAGE")
  TS_BADGE_JSON=$(create_badge_json "TypeScript Coverage" "$TS_COVERAGE" "$TS_COLOR" "typescript")
  
  # Create Rust badge JSON  
  RUST_COLOR=$(get_badge_color "$RUST_COVERAGE")
  RUST_BADGE_JSON=$(create_badge_json "Rust Coverage" "$RUST_COVERAGE" "$RUST_COLOR" "rust")
  
  # Create gist with both badge files
  GIST_RESPONSE=$(curl -s -X POST \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    https://api.github.com/gists \
    -d "{
      \"description\": \"Kleptool Coverage Badges\",
      \"public\": true,
      \"files\": {
        \"kleptool-ts-coverage.json\": {
          \"content\": $(echo "$TS_BADGE_JSON" | jq -R -s .)
        },
        \"kleptool-rust-coverage.json\": {
          \"content\": $(echo "$RUST_BADGE_JSON" | jq -R -s .)
        }
      }
    }")
  
  NEW_GIST_ID=$(echo "$GIST_RESPONSE" | jq -r '.id')
  GIST_OWNER=$(echo "$GIST_RESPONSE" | jq -r '.owner.login')
  
  # Debug: Show the actual response
  echo "DEBUG: Gist API Response:"
  echo "$GIST_RESPONSE" | jq '.'
  
  # Check for common error conditions
  if echo "$GIST_RESPONSE" | jq -e '.message' > /dev/null; then
    local error_message=$(echo "$GIST_RESPONSE" | jq -r '.message')
    log_error "GitHub API error: $error_message"
    
    if [[ "$error_message" == *"Bad credentials"* ]]; then
      log_error "The GITHUB_TOKEN appears to be invalid or expired."
    elif [[ "$error_message" == *"token"* && "$error_message" == *"scope"* ]]; then
      log_error "The GITHUB_TOKEN doesn't have the 'gist' scope required to create gists."
      log_info "Please ensure your token has the 'gist' permission enabled."
    fi
    exit 1
  fi
  
  if [[ "$NEW_GIST_ID" == "null" || -z "$NEW_GIST_ID" ]]; then
    log_error "Failed to create gist - received null ID."
    exit 1
  fi
  
  log_success "Created gist with ID: $NEW_GIST_ID"
  echo ""
  log_step "Setup Instructions:"
  echo "Add this as a repository secret named GIST_ID: $NEW_GIST_ID"
  echo ""
  echo "📋 Badge URLs for your README:"
  echo "TypeScript: https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/$GIST_OWNER/$NEW_GIST_ID/raw/kleptool-ts-coverage.json"
  echo "Rust: https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/$GIST_OWNER/$NEW_GIST_ID/raw/kleptool-rust-coverage.json"
else
  log_step "Updating existing gist: $GIST_ID"
  
  # Update TypeScript badge
  TS_COLOR=$(get_badge_color "$TS_COVERAGE")
  TS_BADGE_JSON=$(create_badge_json "TypeScript Coverage" "$TS_COVERAGE" "$TS_COLOR" "typescript")
  
  # Update Rust badge
  RUST_COLOR=$(get_badge_color "$RUST_COVERAGE")
  RUST_BADGE_JSON=$(create_badge_json "Rust Coverage" "$RUST_COVERAGE" "$RUST_COLOR" "rust")
  
  # Update gist
  UPDATE_RESPONSE=$(curl -s -X PATCH \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    https://api.github.com/gists/$GIST_ID \
    -d "{
      \"files\": {
        \"kleptool-ts-coverage.json\": {
          \"content\": $(echo "$TS_BADGE_JSON" | jq -R -s .)
        },
        \"kleptool-rust-coverage.json\": {
          \"content\": $(echo "$RUST_BADGE_JSON" | jq -R -s .)
        }
      }
    }")
  
  # Check if update was successful
  if echo "$UPDATE_RESPONSE" | jq -e '.id' > /dev/null; then
    log_success "Updated badges in gist $GIST_ID"
  else
    log_error "Failed to update gist. Response:"
    echo "$UPDATE_RESPONSE"
    exit 1
  fi
fi

echo "🎉 Coverage badges updated successfully!" 