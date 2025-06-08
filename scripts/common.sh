#!/bin/bash

# Common utilities for bash scripts
# Source this file in other scripts to use shared functions

# Function to validate required environment variables
validate_env_var() {
  local var_name=$1
  local var_value="${!var_name:-}"
  
  if [[ -z "$var_value" ]]; then
    echo "❌ Error: $var_name environment variable is required" >&2
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
  echo "ℹ️  $1" >&2
}

log_success() {
  echo "✅ $1" >&2
}

log_warning() {
  echo "⚠️  $1" >&2
}

log_error() {
  echo "❌ $1" >&2
}

log_step() {
  echo "🔧 $1" >&2
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

# Function to safely extract JSON value with error handling
extract_json_value() {
  local file="$1"
  local path="$2"
  local default="${3:-null}"
  
  if [[ ! -f "$file" ]]; then
    echo "$default"
    return 1
  fi
  
  local value=$(jq -r "$path" "$file" 2>/dev/null)
  echo "${value:-$default}"
}

# Function to calculate percentage with bc
calculate_percentage() {
  local numerator="$1"
  local denominator="$2"
  local scale="${3:-1}"
  
  if [[ "$denominator" == "0" ]]; then
    echo "0.0"
    return
  fi
  
  echo "scale=$scale; ($numerator * 100) / $denominator" | bc
}

# Function to format difference value with + prefix for positive
format_diff() {
  local value="$1"
  
  if (( $(echo "$value >= 0" | bc -l) )); then
    echo "+$value"
  else
    echo "$value"
  fi
}

# Function to post comment to GitHub PR
post_github_comment() {
  local comment_body="$1"
  local temp_file=$(mktemp)
  
  echo "$comment_body" > "$temp_file"
  
  if [[ -n "${GITHUB_EVENT_PATH:-}" ]] && [[ -f "$GITHUB_EVENT_PATH" ]]; then
    local pr_number=$(jq -r '.pull_request.number // .number // empty' "$GITHUB_EVENT_PATH")
    local repo=$(jq -r '.repository.full_name' "$GITHUB_EVENT_PATH")
    
    if [[ -n "$pr_number" && "$pr_number" != "null" ]]; then
      curl -s -X POST \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/$repo/issues/$pr_number/comments" \
        -d "{\"body\": $(jq -Rs . < "$temp_file")}" > /dev/null
      log_success "Posted comment to PR #$pr_number"
    else
      log_info "Not a PR context, skipping comment posting"
      echo "📝 Comment would have been:"
      cat "$temp_file"
    fi
  else
    log_info "No GitHub event context, skipping comment posting"  
    echo "📝 Comment would have been:"
    cat "$temp_file"
  fi
  
  rm -f "$temp_file"
}
