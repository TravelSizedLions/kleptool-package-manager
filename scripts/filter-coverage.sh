#!/bin/bash
set -e  # Exit on any error for CI/CD reliability

# Module-level constants
readonly LCOV_FILE="coverage/typescript/lcov.info"
readonly LCOV_TEMP="coverage/typescript/lcov.info.tmp"
readonly TEST_FILTER_PATTERN="^SF:.*(src/testing/|\.spec\.ts|\.test\.ts|testing/extensions\.ts|testing/moxxy/|testing/utils/)"

# Helper functions for test execution
__run_tests() {
    echo "🧪 Running tests..."
    if ! bun test > test_output.tmp 2>&1; then
        echo "❌ Tests failed!"
        cat test_output.tmp
        rm -f test_output.tmp
        exit 1
    fi
    return $?
}

__display_test_results() {
    cat test_output.tmp
}

__collect_coverage_data() {
    echo ""
    echo "📊 Collecting coverage data..."
    if ! bun test --coverage --coverage-reporter=text --coverage-reporter=lcov --coverage-dir=coverage/typescript > coverage_output.tmp 2>&1; then
        echo "⚠️  Coverage collection failed, but tests passed"
        rm -f test_output.tmp coverage_output.tmp
        exit $TEST_EXIT_CODE
    fi
}

# Helper functions for coverage filtering
__filter_lcov_file() {
    echo ""
    echo "🔧 Filtering coverage data to exclude testing infrastructure..."
    
    if [ ! -f "$LCOV_FILE" ]; then
        echo "⚠️  Warning: No lcov.info file found to filter"
        return 1
    fi
    
    grep -E -v "$TEST_FILTER_PATTERN" "$LCOV_FILE" > "$LCOV_TEMP"
    mv "$LCOV_TEMP" "$LCOV_FILE"
    echo "✅ Coverage data filtered successfully"
    return 0
}

__calculate_overall_coverage() {
    local lines_found=$(grep -o "LF:[0-9]*" "$LCOV_FILE" | sed 's/LF://' | paste -sd+ | bc 2>/dev/null || echo "0")
    local lines_hit=$(grep -o "LH:[0-9]*" "$LCOV_FILE" | sed 's/LH://' | paste -sd+ | bc 2>/dev/null || echo "0")
    
    if [ "$lines_found" -eq 0 ]; then
        echo "⚠️  No coverage data found in filtered file"
        return 1
    fi
    
    local coverage_percent=$(echo "scale=2; $lines_hit * 100 / $lines_found" | bc 2>/dev/null || echo "0")
    echo "📊 Overall: $lines_hit/$lines_found lines covered (${coverage_percent}%)"
    echo ""
    return 0
}

# Helper functions for formatting
__print_divider() {
    local char="${1:-=}"
    local width="${2:-103}"
    printf "%*s\n" "$width" "" | tr ' ' "$char"
}

# Helper functions for range processing
__convert_lines_to_ranges() {
    local array_name="$1"
    local -n lines_array_ref=$array_name
    local ranges=""
    
    if [ ${#lines_array_ref[@]} -eq 0 ]; then
        echo ""
        return
    fi
    
    local start=${lines_array_ref[0]}
    local end=$start
    
    for ((i=1; i<${#lines_array_ref[@]}; i++)); do
        local current=${lines_array_ref[i]}
        if [ $((current)) -eq $((end + 1)) ]; then
            end=$current
        else
            if [ $start -eq $end ]; then
                ranges="$ranges$start, "
            else
                ranges="$ranges$start-$end, "
            fi
            start=$current
            end=$current
        fi
    done
    
    if [ $start -eq $end ]; then
        ranges="$ranges$start"
    else
        ranges="$ranges$start-$end"
    fi
    
    echo "$ranges"
}

__print_wrapped_ranges() {
    local ranges="$1"
    local current_line=""
    
    for range in $(echo "$ranges" | tr ',' '\n'); do
        range=$(echo "$range" | sed 's/^ *//')  # trim leading spaces
        if [ -z "$range" ]; then
            continue
        fi
        
        local test_line="$current_line$range, "
        if [ ${#test_line} -gt 95 ]; then
            local line_output="${current_line%, }"
            printf "  %s\n" "$line_output"
            current_line="$range, "
        else
            current_line="$test_line"
        fi
    done
    
    if [ -n "$current_line" ]; then
        local line_output="${current_line%, }"
        printf "  %s\n" "$line_output"
    fi
}

__get_coverage_color() {
    local percent="$1"
    
    if (( $(echo "$percent >= 80" | bc -l) )); then
        echo "🟢"
    elif (( $(echo "$percent >= 60" | bc -l) )); then
        echo "🟡"
    else
        echo "🔴"
    fi
}

__format_display_filename() {
    local current_file="$1"
    local display_file=$(echo "$current_file" | sed 's|^src/||' | sed 's|cli/||')
    
    if [ ${#display_file} -gt 55 ]; then
        display_file="...${display_file: -52}"
    fi
    
    echo "$display_file"
}

__print_file_coverage() {
    local display_file="$1"
    local file_lines_found="$2"
    local file_lines_hit="$3"
    local file_lines_uncovered="$4"
    local file_percent="$5"
    local uncovered_lines_array_name="$6"
    
    local color_emoji=$(__get_coverage_color "$file_percent")
    
    printf "%2s %-55s %8s %9s %10s %7s%%\n" "$color_emoji" "$display_file" "$file_lines_found" "$file_lines_hit" "$file_lines_uncovered" "$file_percent"
    
    # Check if array has elements using indirect reference
    local -n uncovered_ref=$uncovered_lines_array_name
    if [ ${#uncovered_ref[@]} -eq 0 ]; then
        return
    fi
    
    echo ""  # Empty row before missing lines
    local ranges=$(__convert_lines_to_ranges "$uncovered_lines_array_name")
    __print_wrapped_ranges "$ranges"
}

__print_table_header() {
    __print_divider
    echo "   File                                                       Lines   Covered  Uncovered  Percent"
    __print_divider
}

__print_table_footer() {
    __print_divider
    echo ""
    echo "🎯 Filtered data excludes all test files and testing infrastructure"
    echo "🟢 >= 80%  🟡 >= 60%  🔴 < 60%"
}

__process_lcov_line() {
    local line="$1"
    local -n current_file_ref=$2
    local -n uncovered_lines_ref=$3
    local -n file_lines_found_ref=$4
    local -n file_lines_hit_ref=$5
    
    if [[ $line == SF:* ]]; then
        current_file_ref=${line#SF:}
        uncovered_lines_ref=()
        return 0
    fi
    
    if [[ $line == DA:* ]]; then
        local line_data=${line#DA:}
        local line_num=${line_data%,*}
        local hit_count=${line_data#*,}
        if [ "$hit_count" -eq 0 ]; then
            uncovered_lines_ref+=("$line_num")
        fi
        return 0
    fi
    
    if [[ $line == LF:* ]]; then
        file_lines_found_ref=${line#LF:}
        return 0
    fi
    
    if [[ $line == LH:* ]]; then
        file_lines_hit_ref=${line#LH:}
        return 0
    fi
    
    if [[ $line == "end_of_record" ]]; then
        return 1  # Signal end of record
    fi
    
    return 0
}

__process_file_record() {
    local current_file="$1"
    local file_lines_found="$2"
    local file_lines_hit="$3"
    local uncovered_lines_array_name="$4"
    local is_last_entry="$5"
    
    if [ -z "$current_file" ] || [ "$file_lines_found" -eq 0 ]; then
        return
    fi
    
    local file_percent=$(echo "scale=1; $file_lines_hit * 100 / $file_lines_found" | bc 2>/dev/null || echo "0.0")
    local file_lines_uncovered=$((file_lines_found - file_lines_hit))
    local display_file=$(__format_display_filename "$current_file")
    
    __print_file_coverage "$display_file" "$file_lines_found" "$file_lines_hit" "$file_lines_uncovered" "$file_percent" "$uncovered_lines_array_name"
    
    # Only print divider if this is not the last entry
    if [ "$is_last_entry" != "true" ]; then
        __print_divider '.'
    fi
}

__collect_file_stats() {
    local current_file=""
    local uncovered_lines=()
    local file_lines_found=0
    local file_lines_hit=0
    
    # Arrays to store all file data
    all_files=()
    all_percentages=()
    all_uncovered_counts=()
    
    while IFS= read -r line; do
        if __process_lcov_line "$line" current_file uncovered_lines file_lines_found file_lines_hit; then
            continue
        fi
        
        # End of record reached - collect stats
        if [ -n "$current_file" ] && [ "$file_lines_found" -gt 0 ]; then
            local file_percent=$(echo "scale=1; $file_lines_hit * 100 / $file_lines_found" | bc 2>/dev/null || echo "0.0")
            local file_lines_uncovered=$((file_lines_found - file_lines_hit))
            local display_file=$(__format_display_filename "$current_file")
            
            all_files+=("$display_file:$file_lines_found:$file_lines_hit:$file_lines_uncovered:$file_percent")
            all_percentages+=("$file_percent")
            all_uncovered_counts+=("$file_lines_uncovered:$display_file")
        fi
        
        # Reset for next file
        current_file=""
        file_lines_found=0
        file_lines_hit=0
        uncovered_lines=()
    done < "$LCOV_FILE"
}

__print_high_level_summary() {
    # Calculate average coverage
    local total_percent=0
    local count=${#all_percentages[@]}
    
    for percent in "${all_percentages[@]}"; do
        total_percent=$(echo "$total_percent + $percent" | bc 2>/dev/null || echo "$total_percent")
    done
    
    local avg_coverage=$(echo "scale=1; $total_percent / $count" | bc 2>/dev/null || echo "0.0")
    
    # Calculate median coverage
    local sorted_percentages=($(printf '%s\n' "${all_percentages[@]}" | sort -n))
    local median_coverage
    local mid=$((count / 2))
    
    if [ $((count % 2)) -eq 0 ]; then
        # Even number of files - average of two middle values
        local mid1=$((mid - 1))
        median_coverage=$(echo "scale=1; (${sorted_percentages[$mid1]} + ${sorted_percentages[$mid]}) / 2" | bc 2>/dev/null || echo "0.0")
    else
        # Odd number of files - middle value
        median_coverage=${sorted_percentages[$mid]}
    fi
    
    # Get top 3 files by uncovered lines
    local sorted_uncovered=($(printf '%s\n' "${all_uncovered_counts[@]}" | sort -nr))
    
    echo "📈 Coverage Summary:"
    echo ""
    echo "• Average coverage: ${avg_coverage}%"
    echo "• Median coverage: ${median_coverage}%"
    echo "• Next 3 suggested files (most uncovered lines):"
    
    for i in 0 1 2; do
        if [ $i -lt ${#sorted_uncovered[@]} ]; then
            local entry="${sorted_uncovered[$i]}"
            local uncovered_count="${entry%:*}"
            local file_name="${entry#*:}"
            echo "  $((i + 1)). $file_name ($uncovered_count lines)"
        fi
    done
    echo ""
}

__generate_coverage_table() {
    __collect_file_stats
    __print_high_level_summary
    __print_table_header
    
    local current_file=""
    local uncovered_lines=()
    local file_lines_found=0
    local file_lines_hit=0
    local entry_count=0
    local total_entries=${#all_files[@]}
    
    while IFS= read -r line; do
        if __process_lcov_line "$line" current_file uncovered_lines file_lines_found file_lines_hit; then
            continue
        fi
        
        # End of record reached
        entry_count=$((entry_count + 1))
        local is_last_entry="false"
        if [ "$entry_count" -eq "$total_entries" ]; then
            is_last_entry="true"
        fi
        
        __process_file_record "$current_file" "$file_lines_found" "$file_lines_hit" "uncovered_lines" "$is_last_entry"
        
        # Reset for next file
        current_file=""
        file_lines_found=0
        file_lines_hit=0
        uncovered_lines=()
    done < "$LCOV_FILE"
    
    __print_table_footer
}

__display_coverage_report() {
    echo ""
    
    if [ ! -f "$LCOV_FILE" ]; then
        echo "⚠️  No filtered coverage file found"
        return 1
    fi
    
    if ! __calculate_overall_coverage; then
        return 1
    fi
    
    __generate_coverage_table
    return 0
}

__cleanup_temp_files() {
    rm -f test_output.tmp coverage_output.tmp
}

__print_completion_message() {
    echo ""
    echo "✅ Tests passed and filtered coverage report generated!"
    echo "📁 Full LCOV report available in: coverage/typescript/"
    
    if [ ! -d "coverage/typescript" ]; then
        echo "⚠️  Warning: Coverage directory not created - check LCOV generation"
    fi
}

# Main execution flow
main() {
    __run_tests
    local test_exit_code=$?
    
    __display_test_results
    __collect_coverage_data
    __filter_lcov_file
    __display_coverage_report
    __cleanup_temp_files
    __print_completion_message
    
    exit $test_exit_code
}

# Execute main function
main "$@" 