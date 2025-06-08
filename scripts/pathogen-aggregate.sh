#!/usr/bin/env bash
set -euo pipefail

# Pathogen Final Report Aggregator
# Combines JSON report with enhanced summaries and insights

REPORT_FILE="pathogen-report.json"
AGGREGATE_DIR="pathogen-reports"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
AGGREGATE_FILE="${AGGREGATE_DIR}/pathogen-aggregate-${TIMESTAMP}.json"

echo "📊 Aggregating pathogen results..."

# Create reports directory
mkdir -p "$AGGREGATE_DIR"

# Check if report exists
if [[ ! -f "$REPORT_FILE" ]]; then
    echo "❌ No pathogen report found at $REPORT_FILE"
    exit 1
fi

# Extract key metrics from JSON report
TOTAL_MUTATIONS=$(jq '.stats.total_mutations' "$REPORT_FILE")
BEHAVIORAL_KILLS=$(jq '.stats.behavioral_kills' "$REPORT_FILE")
SURVIVED=$(jq '.stats.survived' "$REPORT_FILE")
DURATION=$(jq '.stats.duration' "$REPORT_FILE")

# Calculate rates with proper error handling
if [[ "$TOTAL_MUTATIONS" != "0" && "$TOTAL_MUTATIONS" != "null" ]]; then
  KILL_RATE=$(echo "scale=2; $BEHAVIORAL_KILLS * 100 / $TOTAL_MUTATIONS" | bc -l 2>/dev/null || echo "0")
else
  KILL_RATE="0"
fi

if [[ "$DURATION" != "0" && "$DURATION" != "null" ]] && (( $(echo "$DURATION > 0" | bc -l 2>/dev/null) )); then
  MUTATIONS_PER_SEC=$(echo "scale=1; $TOTAL_MUTATIONS / $DURATION" | bc -l 2>/dev/null || echo "0")
else
  MUTATIONS_PER_SEC="0"
fi

# Copy and enhance the report
cp "$REPORT_FILE" "$AGGREGATE_FILE"

echo ""
echo "Report saved to: $AGGREGATE_FILE" 
