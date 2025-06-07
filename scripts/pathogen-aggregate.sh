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

# Generate and print clean summary to console
echo ""
echo "=================================================================================="
echo "🧬 PATHOGEN MUTATION TESTING REPORT"
echo "=================================================================================="
echo "Generated: $(date)"
echo "Duration: ${DURATION}s"
echo "Performance: ${MUTATIONS_PER_SEC} mutations/sec"
echo ""
echo "📊 SUMMARY"
echo "────────────────────────────────────────────────────────────────────────────────"
echo "Total Mutations: $TOTAL_MUTATIONS"
echo "Behavioral Kills: $BEHAVIORAL_KILLS (${KILL_RATE}%)"
echo "Survivors: $SURVIVED"
echo "Kill Rate: ${KILL_RATE}%"
echo ""
echo "🎯 QUALITY ASSESSMENT"
echo "────────────────────────────────────────────────────────────────────────────────"

# Add quality grade
if (( $(echo "$KILL_RATE >= 95" | bc -l) )); then
    echo "Grade: 🟢 EXCELLENT (${KILL_RATE}% kill rate)"
elif (( $(echo "$KILL_RATE >= 85" | bc -l) )); then
    echo "Grade: 🟡 GOOD (${KILL_RATE}% kill rate)"
else
    echo "Grade: 🔴 NEEDS IMPROVEMENT (${KILL_RATE}% kill rate)"
fi

echo ""
echo "📁 PER-FILE COVERAGE"
echo "────────────────────────────────────────────────────────────────────────────────"
printf "%-50s %10s %10s\n" "File" "Kill Rate" "Survivors"
echo "────────────────────────────────────────────────────────────────────────────────"

jq -r '.stats.per_file_stats[]? // empty | "\(.file_path) \(.kill_rate | floor) \(.survived)"' "$REPORT_FILE" 2>/dev/null | while read -r file rate survivors; do
    printf "%-50s %9s%% %10s\n" "$file" "$rate" "$survivors"
done || echo "No file stats available"

echo ""
echo "🔴 FILES NEEDING ATTENTION"
echo "────────────────────────────────────────────────────────────────────────────────"
jq -r '.stats.per_file_stats[]? // empty | select(.kill_rate < 95) | "\(.file_path): \(.kill_rate | floor)% kill rate (\(.survived) survivors)"' "$REPORT_FILE" 2>/dev/null | while read -r line; do
    echo "• $line"
done || echo "• No files needing attention"

echo ""
echo "⚡ PERFORMANCE METRICS"
echo "────────────────────────────────────────────────────────────────────────────────"
echo "Speed: ${MUTATIONS_PER_SEC} mutations/sec"
echo "Parallelization: Auto-detected cores"
echo "Isolation: Temp workspace used"

echo "=================================================================================="
echo ""
echo "✅ JSON report saved to: $AGGREGATE_FILE"
echo ""
echo "📊 Final Results:"
echo "   🧬 Total: $TOTAL_MUTATIONS mutations"
echo "   💀 Killed: $BEHAVIORAL_KILLS (${KILL_RATE}%)"
echo "   😱 Survived: $SURVIVED"
echo "   ⚡ Speed: ${MUTATIONS_PER_SEC} mutations/sec" 
