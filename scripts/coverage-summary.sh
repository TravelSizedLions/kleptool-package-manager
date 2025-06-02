#!/bin/bash

# Generate coverage summary for GitHub Actions
# This script parses LCOV files and outputs a markdown summary to GitHub's step summary

set -e

# Default to stdout if GITHUB_STEP_SUMMARY is not set (for local testing)
SUMMARY_OUTPUT=${GITHUB_STEP_SUMMARY:-/dev/stdout}

echo "## Coverage Report" >> "$SUMMARY_OUTPUT"
echo "" >> "$SUMMARY_OUTPUT"

# Function to parse LCOV and calculate coverage percentage
parse_lcov_coverage() {
    local lcov_file="$1"
    local coverage_type="$2"
    
    echo "### $coverage_type Coverage" >> "$SUMMARY_OUTPUT"
    
    if [ -f "$lcov_file" ]; then
        # Parse LCOV for basic stats
        LINES_FOUND=$(grep -c "^DA:" "$lcov_file" 2>/dev/null || echo "0")
        LINES_HIT=$(grep "^DA:" "$lcov_file" 2>/dev/null | grep -v ",0$" | wc -l || echo "0")
        
        if [ "$LINES_FOUND" -gt 0 ]; then
            COVERAGE_PERCENT=$(( LINES_HIT * 100 / LINES_FOUND ))
            echo "- **Lines covered:** $LINES_HIT / $LINES_FOUND ($COVERAGE_PERCENT%)" >> "$SUMMARY_OUTPUT"
            
            # Add coverage badge-style indicator
            if [ "$COVERAGE_PERCENT" -ge 80 ]; then
                echo "- **Quality:** 🟢 Good coverage" >> "$SUMMARY_OUTPUT"
            elif [ "$COVERAGE_PERCENT" -ge 60 ]; then
                echo "- **Quality:** 🟡 Moderate coverage" >> "$SUMMARY_OUTPUT"
            else
                echo "- **Quality:** 🔴 Low coverage" >> "$SUMMARY_OUTPUT"
            fi
        else
            echo "- **Lines covered:** No data available" >> "$SUMMARY_OUTPUT"
        fi
    else
        echo "- **Status:** No coverage file found" >> "$SUMMARY_OUTPUT"
    fi
    
    echo "" >> "$SUMMARY_OUTPUT"
}

# Parse TypeScript coverage
parse_lcov_coverage "coverage/typescript/lcov.info" "TypeScript"

# Parse Rust coverage  
parse_lcov_coverage "coverage/rust/lcov.info" "Rust"

# Add a combined summary if both files exist
if [ -f "coverage/typescript/lcov.info" ] && [ -f "coverage/rust/lcov.info" ]; then
    echo "### Combined Project Coverage" >> "$SUMMARY_OUTPUT"
    
    # Calculate combined coverage
    TS_LINES_FOUND=$(grep -c "^DA:" coverage/typescript/lcov.info 2>/dev/null || echo "0")
    TS_LINES_HIT=$(grep "^DA:" coverage/typescript/lcov.info 2>/dev/null | grep -v ",0$" | wc -l || echo "0")
    
    RUST_LINES_FOUND=$(grep -c "^DA:" coverage/rust/lcov.info 2>/dev/null || echo "0")
    RUST_LINES_HIT=$(grep "^DA:" coverage/rust/lcov.info 2>/dev/null | grep -v ",0$" | wc -l || echo "0")
    
    TOTAL_LINES_FOUND=$((TS_LINES_FOUND + RUST_LINES_FOUND))
    TOTAL_LINES_HIT=$((TS_LINES_HIT + RUST_LINES_HIT))
    
    if [ "$TOTAL_LINES_FOUND" -gt 0 ]; then
        TOTAL_COVERAGE_PERCENT=$(( TOTAL_LINES_HIT * 100 / TOTAL_LINES_FOUND ))
        echo "- **Overall:** $TOTAL_LINES_HIT / $TOTAL_LINES_FOUND lines ($TOTAL_COVERAGE_PERCENT%)" >> "$SUMMARY_OUTPUT"
    fi
    
    echo "" >> "$SUMMARY_OUTPUT"
fi

echo "📁 **Coverage artifacts have been uploaded for detailed analysis**" >> "$SUMMARY_OUTPUT" 