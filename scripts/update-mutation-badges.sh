#!/bin/bash

# Script to create or update behavioral coverage badges using GitHub Gists and Shields.io
# Expects the following environment variables:
# - GITHUB_TOKEN: GitHub token for API access
# - GIST_ID: (optional) Existing gist ID to update
# - KILL_RATE: Total kill rate percentage (e.g., "99.6")
# - BEHAVIORAL_RATE: Behavioral kill rate percentage (e.g., "98.7")

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

# Get badge color based on mutation testing percentage
get_mutation_badge_color() {
  local percentage=$1
  # Remove % if present
  percentage=${percentage%\%}
  
  if (( $(echo "$percentage >= 95" | bc -l) )); then
    echo "brightgreen"
  elif (( $(echo "$percentage >= 80" | bc -l) )); then
    echo "green"
  elif (( $(echo "$percentage >= 60" | bc -l) )); then
    echo "yellow"
  elif (( $(echo "$percentage >= 40" | bc -l) )); then
    echo "orange"
  else
    echo "red"
  fi
}

# Validate required environment variables
validate_env_vars "GITHUB_TOKEN" "KILL_RATE" "BEHAVIORAL_RATE"

log_step "Updating behavioral coverage badges..."
log_info "Total kill rate: ${KILL_RATE}%"
log_info "Behavioral kill rate: ${BEHAVIORAL_RATE}%"

# Create Kill Rate badge JSON
KILL_COLOR=$(get_mutation_badge_color "$KILL_RATE")
KILL_BADGE_JSON=$(create_badge_json "Mutation Kill Rate" "${KILL_RATE}%" "$KILL_COLOR" "rust")

# Create Behavioral Rate badge JSON  
BEHAVIORAL_COLOR=$(get_mutation_badge_color "$BEHAVIORAL_RATE")
BEHAVIORAL_BADGE_JSON=$(create_badge_json "Behavioral Coverage" "${BEHAVIORAL_RATE}%" "$BEHAVIORAL_COLOR" "rust")

echo "🎉 Behavioral coverage badges created successfully!" 