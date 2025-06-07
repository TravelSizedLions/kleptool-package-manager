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

 