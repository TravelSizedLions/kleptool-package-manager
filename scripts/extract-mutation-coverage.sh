#!/bin/bash

# Script to extract behavioral coverage percentages from mutation testing JSON report
# Outputs coverage percentages for kill rate and behavioral rate to GitHub Actions outputs
# Expects mutation report at: ./mutations-report.json

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source common utilities
source "$SCRIPT_DIR/common.sh"

echo "🧬 Extracting behavioral coverage percentages..."

# Validate required environment variables
validate_env_var "GITHUB_OUTPUT"

# Check if mutation report exists
if [[ ! -f "./mutations-report.json" ]]; then
    echo "❌ Mutation report not found at ./mutations-report.json"
    exit 1
fi

# Extract behavioral coverage metrics using jq
echo "📊 Parsing mutation testing results..."

# Calculate kill rate (behavioral kills + compile errors / total)
TOTAL_MUTATIONS=$(jq -r '.stats.total_mutations' ./mutations-report.json)
BEHAVIORAL_KILLS=$(jq -r '.stats.behavioral_kills' ./mutations-report.json)
COMPILE_ERRORS=$(jq -r '.stats.compile_errors' ./mutations-report.json)
SURVIVED=$(jq -r '.stats.survived' ./mutations-report.json)

if [[ "$TOTAL_MUTATIONS" == "null" || "$BEHAVIORAL_KILLS" == "null" || "$COMPILE_ERRORS" == "null" ]]; then
    echo "❌ Failed to parse mutation testing statistics from JSON"
    exit 1
fi

# Calculate percentages
if [[ "$TOTAL_MUTATIONS" -gt 0 ]]; then
    KILL_RATE=$(echo "scale=1; (($BEHAVIORAL_KILLS + $COMPILE_ERRORS) * 100) / $TOTAL_MUTATIONS" | bc)
    BEHAVIORAL_RATE=$(echo "scale=1; ($BEHAVIORAL_KILLS * 100) / $TOTAL_MUTATIONS" | bc)
else
    KILL_RATE="0.0"
    BEHAVIORAL_RATE="0.0"
fi

# Output to GitHub Actions
echo "kill_rate=${KILL_RATE}" >> "$GITHUB_OUTPUT"
echo "behavioral_rate=${BEHAVIORAL_RATE}" >> "$GITHUB_OUTPUT"

echo "🎯 Behavioral Coverage Results:"
echo "   📊 Total Mutations: $TOTAL_MUTATIONS"
echo "   💀 Kill Rate: ${KILL_RATE}%"
echo "   🧬 Behavioral Rate: ${BEHAVIORAL_RATE}%"
echo "   😱 Survived: $SURVIVED"
echo "🎉 Behavioral coverage extraction completed!" 