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

# Main entry point
main() {
  __validate_required_env_vars
  
  log_step "Updating behavioral coverage badges..."
  __display_rates
  
  local kill_badge behavioral_badge
  kill_badge=$(__create_kill_rate_badge)
  behavioral_badge=$(__create_behavioral_badge)
  
  __output_badge_results "$kill_badge" "$behavioral_badge"
  echo "🎉 Behavioral coverage badges created successfully!"
}

# Validate all required environment variables
__validate_required_env_vars() {
  validate_env_vars "GITHUB_TOKEN" "KILL_RATE" "BEHAVIORAL_RATE"
}

# Display current mutation rates
__display_rates() {
  log_info "Total kill rate: ${KILL_RATE}%"
  log_info "Behavioral kill rate: ${BEHAVIORAL_RATE}%"
}

# Create kill rate badge JSON
__create_kill_rate_badge() {
  local color
  color=$(__get_mutation_badge_color "$KILL_RATE")
  __create_badge_json "Mutation Kill Rate" "${KILL_RATE}%" "$color" "rust"
}

# Create behavioral coverage badge JSON
__create_behavioral_badge() {
  local color
  color=$(__get_mutation_badge_color "$BEHAVIORAL_RATE")
  __create_badge_json "Behavioral Coverage" "${BEHAVIORAL_RATE}%" "$color" "rust"
}

# Create badge JSON content
__create_badge_json() {
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
__get_mutation_badge_color() {
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

# Output badge results (could be extended for gist upload)
__output_badge_results() {
  local kill_badge=$1
  local behavioral_badge=$2
  
  # For now, just create the JSON (could be extended to upload to gists)
  # This is where gist upload logic would go if needed
  log_info "Kill rate badge JSON created"
  log_info "Behavioral coverage badge JSON created"
}

# Run main function
main "$@" 
