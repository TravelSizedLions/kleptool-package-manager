#!/bin/bash

# Common utilities for bash scripts
# Source this file in other scripts to use shared functions

# Function to validate required environment variables
validate_env_var() {
  local var_name=$1
  local var_value="${!var_name:-}"
  
  if [[ -z "$var_value" ]]; then
    echo "❌ Error: $var_name environment variable is required"
    exit 1
  fi
}

# Function to validate multiple environment variables
validate_env_vars() {
  local vars=("$@")
  for var in "${vars[@]}"; do
    validate_env_var "$var"
  done
}

# Function to log with emoji prefix
log_info() {
  echo "ℹ️  $1"
}

log_success() {
  echo "✅ $1"
}

log_warning() {
  echo "⚠️  $1"
}

log_error() {
  echo "❌ $1"
}

log_step() {
  echo "🔧 $1"
}

# Function to determine badge color based on coverage percentage
get_badge_color() {
  local coverage=$1
  local percent=$(echo $coverage | sed 's/%//')
  
  if (( $(echo "$percent >= 90" | bc -l) )); then
    echo "brightgreen"
  elif (( $(echo "$percent >= 80" | bc -l) )); then
    echo "green"  
  elif (( $(echo "$percent >= 70" | bc -l) )); then
    echo "yellowgreen"
  elif (( $(echo "$percent >= 60" | bc -l) )); then
    echo "yellow"
  elif (( $(echo "$percent >= 50" | bc -l) )); then
    echo "orange"
  else
    echo "red"
  fi
}

# Function to extract coverage percentage from an LCOV file
extract_coverage_from_lcov() {
  local lcov_file=$1
  local language_name=$2
  local output_var_name="${3:-}"
  
  if [[ ! -f "$lcov_file" ]]; then
    log_warning "LCOV file not found: $lcov_file"
    if [[ -n "$output_var_name" ]]; then
      printf -v "$output_var_name" "0%%"
    elif [[ -n "${GITHUB_OUTPUT:-}" ]]; then
      echo "${language_name,,}_coverage=0%" >> $GITHUB_OUTPUT
    fi
    return 0
  fi
  
  # Extract lines found and lines hit from LCOV file
  local lines_found=$(grep -o "LF:[0-9]*" "$lcov_file" | sed 's/LF://' | paste -sd+ | bc)
  local lines_hit=$(grep -o "LH:[0-9]*" "$lcov_file" | sed 's/LH://' | paste -sd+ | bc)
  
  if [[ "$lines_found" -gt 0 ]]; then
    local coverage=$(echo "scale=1; $lines_hit * 100 / $lines_found" | bc)
    log_success "$language_name coverage: ${coverage}%"
    
    if [[ -n "$output_var_name" ]]; then
      printf -v "$output_var_name" "${coverage}%%"
    elif [[ -n "${GITHUB_OUTPUT:-}" ]]; then
      echo "${language_name,,}_coverage=${coverage}%" >> $GITHUB_OUTPUT
    fi
  else
    log_warning "No lines found in $lcov_file"
    if [[ -n "$output_var_name" ]]; then
      printf -v "$output_var_name" "0%%"
    elif [[ -n "${GITHUB_OUTPUT:-}" ]]; then
      echo "${language_name,,}_coverage=0%" >> $GITHUB_OUTPUT
    fi
  fi
} 