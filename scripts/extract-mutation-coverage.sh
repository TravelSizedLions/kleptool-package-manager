#!/bin/bash

# Script to extract behavioral coverage percentages from mutation testing JSON report
# Outputs coverage percentages for kill rate and behavioral rate to GitHub Actions outputs
# Expects mutation report at: ./mutations-report.json

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source common utilities
source "$SCRIPT_DIR/common.sh"

# Main entry point
main() {
  log_step "Extracting behavioral coverage percentages..."
  validate_env_var "GITHUB_OUTPUT"
  
  local report_file="./mutations-report.json"
  __validate_report_exists "$report_file"
  
  local metrics
  metrics=$(__extract_mutation_metrics "$report_file")
  
  local kill_rate behavioral_rate
  kill_rate=$(__calculate_kill_rate "$metrics")
  behavioral_rate=$(__calculate_behavioral_rate "$metrics")
  
  __output_to_github_actions "$kill_rate" "$behavioral_rate"
  __display_results "$metrics" "$kill_rate" "$behavioral_rate"
  
  echo "🎉 Behavioral coverage extraction completed!"
}

# Validate that the mutation report file exists
__validate_report_exists() {
  local report_file="$1"
  
  if [[ ! -f "$report_file" ]]; then
    echo "❌ Mutation report not found at $report_file"
    exit 1
  fi
}

# Extract all mutation metrics from JSON report
__extract_mutation_metrics() {
  local report_file="$1"
  
  echo "📊 Parsing mutation testing results..."
  
  local total behavioral compile_errors survived
  total=$(extract_json_value "$report_file" ".stats.total_mutations" "null")
  behavioral=$(extract_json_value "$report_file" ".stats.behavioral_kills" "null")
  compile_errors=$(extract_json_value "$report_file" ".stats.compile_errors" "null")
  survived=$(extract_json_value "$report_file" ".stats.survived" "null")
  
  if [[ "$total" == "null" || "$behavioral" == "null" || "$compile_errors" == "null" ]]; then
    echo "❌ Failed to parse mutation testing statistics from JSON"
    exit 1
  fi
  
  echo "$total,$behavioral,$compile_errors,$survived"
}

# Calculate kill rate percentage
__calculate_kill_rate() {
  local metrics="$1"
  
  local total behavioral compile_errors
  IFS=',' read -r total behavioral compile_errors _ <<< "$metrics"
  
  if [[ "$total" -gt 0 ]]; then
    calculate_percentage "$((behavioral + compile_errors))" "$total" 1
  else
    echo "0.0"
  fi
}

# Calculate behavioral rate percentage
__calculate_behavioral_rate() {
  local metrics="$1"
  
  local total behavioral
  IFS=',' read -r total behavioral _ _ <<< "$metrics"
  
  if [[ "$total" -gt 0 ]]; then
    calculate_percentage "$behavioral" "$total" 1
  else
    echo "0.0"
  fi
}

# Output results to GitHub Actions
__output_to_github_actions() {
  local kill_rate="$1"
  local behavioral_rate="$2"
  
  echo "kill_rate=${kill_rate}" >> "$GITHUB_OUTPUT"
  echo "behavioral_rate=${behavioral_rate}" >> "$GITHUB_OUTPUT"
}

# Display formatted results
__display_results() {
  local metrics="$1"
  local kill_rate="$2"
  local behavioral_rate="$3"
  
  local total behavioral compile_errors survived
  IFS=',' read -r total behavioral compile_errors survived <<< "$metrics"
  
  echo "🎯 Behavioral Coverage Results:"
  echo "   📊 Total Mutations: $total"
  echo "   💀 Kill Rate: ${kill_rate}%"
  echo "   🧬 Behavioral Rate: ${behavioral_rate}%"
  echo "   😱 Survived: $survived"
}

# Run main function
main "$@" 