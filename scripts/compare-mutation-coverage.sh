#!/bin/bash

# Script to compare mutation testing results between current PR and baseline
# Creates a GitHub comment with behavioral coverage comparison
# Usage: 
#   ./compare-mutation-coverage.sh <current-report.json> [baseline-report.json]

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source common utilities
source "$SCRIPT_DIR/common.sh"

# Main entry point
main() {
  local current_report="$1"
  local baseline_report="${2:-}"
  
  log_step "Comparing behavioral coverage results..."
  validate_env_var "GITHUB_TOKEN"
  
  __validate_current_report "$current_report"
  
  local current_metrics
  current_metrics=$(__extract_current_metrics "$current_report")
  
  local comment_body
  comment_body=$(__build_comment_body "$current_metrics" "$baseline_report")
  
  post_github_comment "$comment_body"
  log_success "Behavioral coverage comparison completed!"
}

__validate_current_report() {
  local report="$1"
  
  if [[ ! -f "$report" ]]; then
    log_error "Current mutation report not found at $report"
    exit 1
  fi
}

__extract_current_metrics() {
  local report="$1"
  
  log_info "Parsing current mutation testing results..."
  
  local total behavioral compile_errors survived duration
  total=$(extract_json_value "$report" '.stats.total_mutations')
  behavioral=$(extract_json_value "$report" '.stats.behavioral_kills')
  compile_errors=$(extract_json_value "$report" '.stats.compile_errors')
  survived=$(extract_json_value "$report" '.stats.survived')
  duration=$(extract_json_value "$report" '.stats.duration')
  
  if [[ "$total" == "null" ]]; then
    log_error "Failed to parse current mutation testing statistics"
    exit 1
  fi
  
  echo "$total,$behavioral,$compile_errors,$survived,$duration"
}

__calculate_rates() {
  local total="$1"
  local behavioral="$2"
  local compile_errors="$3"
  local duration="$4"
  
  local kill_rate behavioral_rate mut_per_sec
  kill_rate=$(calculate_percentage $((behavioral + compile_errors)) "$total")
  behavioral_rate=$(calculate_percentage "$behavioral" "$total")
  mut_per_sec=$(echo "scale=1; $total / $duration" | bc)
  
  echo "$kill_rate,$behavioral_rate,$mut_per_sec"
}

__build_current_section() {
  local metrics="$1"
  
  IFS=',' read -r total behavioral compile_errors survived duration <<< "$metrics"
  local rates
  rates=$(__calculate_rates "$total" "$behavioral" "$compile_errors" "$duration")
  IFS=',' read -r kill_rate behavioral_rate mut_per_sec <<< "$rates"
  
  cat << EOF
## 🧬 Behavioral Coverage Report (Mutation Testing)

### 📊 Current Results
- **Total Mutations**: $total
- **Kill Rate**: ${kill_rate}% ($((behavioral + compile_errors))/$total killed)
- **Behavioral Kills**: ${behavioral_rate}% ($behavioral/$total)
- **Compile Errors**: $compile_errors
- **Survived**: $survived
- **Performance**: ${mut_per_sec} mutations/sec

EOF
}

__build_baseline_section() {
  local current_metrics="$1"
  local baseline_report="$2"
  
  if [[ -z "$baseline_report" || ! -f "$baseline_report" ]]; then
    cat << EOF
### 📝 Note
No baseline available for comparison (first run on this branch).

EOF
    return
  fi
  
  local baseline_metrics
  baseline_metrics=$(__extract_baseline_metrics "$baseline_report")
  
  if [[ -z "$baseline_metrics" ]]; then
    return
  fi
  
  __build_comparison_content "$current_metrics" "$baseline_metrics"
}

__extract_baseline_metrics() {
  local report="$1"
  
  log_info "Parsing baseline mutation testing results..."
  
  local total behavioral compile_errors survived
  total=$(extract_json_value "$report" '.stats.total_mutations')
  behavioral=$(extract_json_value "$report" '.stats.behavioral_kills')
  compile_errors=$(extract_json_value "$report" '.stats.compile_errors')
  survived=$(extract_json_value "$report" '.stats.survived')
  
  if [[ "$total" == "null" ]]; then
    return
  fi
  
  echo "$total,$behavioral,$compile_errors,$survived"
}

__build_comparison_content() {
  local current_metrics="$1"
  local baseline_metrics="$2"
  
  IFS=',' read -r curr_total curr_behavioral curr_compile curr_survived curr_duration <<< "$current_metrics"
  IFS=',' read -r base_total base_behavioral base_compile base_survived <<< "$baseline_metrics"
  
  local curr_kill_rate curr_behavioral_rate
  local base_kill_rate base_behavioral_rate
  
  curr_kill_rate=$(calculate_percentage $((curr_behavioral + curr_compile)) "$curr_total")
  curr_behavioral_rate=$(calculate_percentage "$curr_behavioral" "$curr_total")
  base_kill_rate=$(calculate_percentage $((base_behavioral + base_compile)) "$base_total")
  base_behavioral_rate=$(calculate_percentage "$base_behavioral" "$base_total")
  
  local kill_rate_diff behavioral_rate_diff survived_diff
  kill_rate_diff=$(echo "scale=1; $curr_kill_rate - $base_kill_rate" | bc)
  behavioral_rate_diff=$(echo "scale=1; $curr_behavioral_rate - $base_behavioral_rate" | bc)
  survived_diff=$((curr_survived - base_survived))
  
  kill_rate_diff=$(format_diff "$kill_rate_diff")
  behavioral_rate_diff=$(format_diff "$behavioral_rate_diff")
  [[ $survived_diff -gt 0 ]] && survived_diff="+$survived_diff"
  
  cat << EOF
### 📈 Comparison vs Baseline
- **Kill Rate**: ${curr_kill_rate}% (${kill_rate_diff}%)
- **Behavioral Rate**: ${curr_behavioral_rate}% (${behavioral_rate_diff}%)
- **Survived**: $curr_survived (${survived_diff})

EOF
}

__build_quality_section() {
  local metrics="$1"
  
  IFS=',' read -r total behavioral _ _ duration <<< "$metrics"
  local behavioral_rate
  behavioral_rate=$(calculate_percentage "$behavioral" "$total")
  
  local quality
  if (( $(echo "$behavioral_rate >= 95" | bc -l) )); then
    quality="🟢 **EXCELLENT** - Outstanding behavioral coverage!"
  elif (( $(echo "$behavioral_rate >= 80" | bc -l) )); then
    quality="🟡 **GOOD** - Solid behavioral coverage"
  elif (( $(echo "$behavioral_rate >= 60" | bc -l) )); then
    quality="🟠 **MODERATE** - Consider improving test coverage"
  else
    quality="🔴 **NEEDS IMPROVEMENT** - Low behavioral coverage detected"
  fi
  
  local mut_per_sec
  mut_per_sec=$(echo "scale=1; $total / $duration" | bc)
  
  cat << EOF
### 🎯 Quality Assessment
$quality

### 🚀 Performance
Completed in ${duration}s at ${mut_per_sec} mutations/sec

---
*Generated by Klep Mutation Testing v2 🦀*
EOF
}

__build_comment_body() {
  local current_metrics="$1"
  local baseline_report="$2"
  
  local current_section baseline_section quality_section
  current_section=$(__build_current_section "$current_metrics")
  baseline_section=$(__build_baseline_section "$current_metrics" "$baseline_report")
  quality_section=$(__build_quality_section "$current_metrics")
  
  echo "$current_section"
  echo "$baseline_section"
  echo "$quality_section"
}

# Execute main function with all arguments
main "$@" 
