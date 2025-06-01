#!/bin/bash
set -euo pipefail

# setup-path.sh - Cross-platform PATH setup for CI environments
# This script ensures klep is available in CI by adding the appropriate directories to PATH

echo "🔧 Setting up PATH for klep CLI..."

# Add current directory to PATH for klep access
# This is where the linking step creates klep.cmd (Windows) or klep (Unix)
echo "📁 Adding workspace to PATH: $GITHUB_WORKSPACE"
echo "$GITHUB_WORKSPACE" >> "$GITHUB_PATH"

# Also add traditional bin directory based on platform
if [[ "$RUNNER_OS" == "Windows" ]]; then
    echo "🪟 Adding Windows user bin to PATH: $USERPROFILE/.local/bin"
    echo "$USERPROFILE/.local/bin" >> "$GITHUB_PATH"
else
    echo "🐧 Adding Unix user bin to PATH: $HOME/.local/bin" 
    echo "$HOME/.local/bin" >> "$GITHUB_PATH"
fi

echo "✅ PATH setup complete for $RUNNER_OS" 