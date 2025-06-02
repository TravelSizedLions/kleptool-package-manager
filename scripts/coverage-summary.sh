#!/bin/bash

# Generate coverage summary for GitHub Actions
# This script parses LCOV files and outputs a markdown summary to GitHub's step summary

set -e

# Default to stdout if GITHUB_STEP_SUMMARY is not set (for local testing)
SUMMARY_OUTPUT=${GITHUB_STEP_SUMMARY:-/dev/stdout}

# Write a line to the summary output
write_summary() {
    echo "$1" >> "$SUMMARY_OUTPUT"
}

# Get coverage stats from LCOV file
get_coverage_stats() {
    local lcov_file="$1"
    
    # Early return if file doesn't exist
    [ ! -f "$lcov_file" ] && echo "0 0" && return
    
    local lines_found=$(grep -c "^DA:" "$lcov_file" 2>/dev/null || echo "0")
    local lines_hit=$(grep "^DA:" "$lcov_file" 2>/dev/null | grep -v ",0$" | wc -l || echo "0")
    
    echo "$lines_found $lines_hit"
}

# Calculate coverage percentage
calculate_percentage() {
    local lines_found="$1"
    local lines_hit="$2"
    
    [ "$lines_found" -eq 0 ] && echo "0" && return
    
    echo $(( lines_hit * 100 / lines_found ))
}

# Get quality indicator based on coverage percentage
get_quality_indicator() {
    local percentage="$1"
    
    [ "$percentage" -ge 80 ] && echo "🟢 Good coverage" && return
    [ "$percentage" -ge 60 ] && echo "🟡 Moderate coverage" && return
    echo "🔴 Low coverage"
}

# Handle missing coverage file
handle_missing_file() {
    local coverage_type="$1"
    
    write_summary "### $coverage_type Coverage"
    write_summary "- **Status:** No coverage file found"
    write_summary ""
}

# Handle coverage with no data
handle_no_data() {
    local coverage_type="$1"
    
    write_summary "### $coverage_type Coverage"
    write_summary "- **Lines covered:** No data available"
    write_summary ""
}

# Handle valid coverage data
handle_coverage_data() {
    local coverage_type="$1"
    local lines_found="$2"
    local lines_hit="$3"
    local percentage="$4"
    
    write_summary "### $coverage_type Coverage"
    write_summary "- **Lines covered:** $lines_hit / $lines_found ($percentage%)"
    write_summary "- **Quality:** $(get_quality_indicator "$percentage")"
    write_summary ""
}

# Parse LCOV coverage for a specific language
parse_lcov_coverage() {
    local lcov_file="$1"
    local coverage_type="$2"
    
    # Early return if file doesn't exist
    [ ! -f "$lcov_file" ] && handle_missing_file "$coverage_type" && return
    
    local stats=$(get_coverage_stats "$lcov_file")
    local lines_found=$(echo "$stats" | cut -d' ' -f1)
    local lines_hit=$(echo "$stats" | cut -d' ' -f2)
    
    # Early return if no data
    [ "$lines_found" -eq 0 ] && handle_no_data "$coverage_type" && return
    
    local percentage=$(calculate_percentage "$lines_found" "$lines_hit")
    handle_coverage_data "$coverage_type" "$lines_found" "$lines_hit" "$percentage"
}

# Generate combined coverage summary
generate_combined_summary() {
    local ts_file="coverage/typescript/lcov.info"
    local rust_file="coverage/rust/lcov.info"
    
    # Early return if either file is missing
    [ ! -f "$ts_file" ] && return
    [ ! -f "$rust_file" ] && return
    
    local ts_stats=$(get_coverage_stats "$ts_file")
    local rust_stats=$(get_coverage_stats "$rust_file")
    
    local ts_found=$(echo "$ts_stats" | cut -d' ' -f1)
    local ts_hit=$(echo "$ts_stats" | cut -d' ' -f2)
    local rust_found=$(echo "$rust_stats" | cut -d' ' -f1)
    local rust_hit=$(echo "$rust_stats" | cut -d' ' -f2)
    
    local total_found=$((ts_found + rust_found))
    local total_hit=$((ts_hit + rust_hit))
    
    # Early return if no data
    [ "$total_found" -eq 0 ] && return
    
    local total_percentage=$(calculate_percentage "$total_found" "$total_hit")
    
    write_summary "### Combined Project Coverage"
    write_summary "- **Overall:** $total_hit / $total_found lines ($total_percentage%)"
    write_summary ""
}

# Main execution
main() {
    write_summary "## Coverage Report"
    write_summary ""
    
    parse_lcov_coverage "coverage/typescript/lcov.info" "TypeScript"
    parse_lcov_coverage "coverage/rust/lcov.info" "Rust"
    
    generate_combined_summary
    
    write_summary "📁 **Coverage artifacts have been uploaded for detailed analysis**"
}

main 