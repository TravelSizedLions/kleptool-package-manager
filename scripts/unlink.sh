#!/usr/bin/env bash

# Cross-platform klep unlinking script
# Removes klep wrapper/symlink for the current platform

set -e  # Exit on any error

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Unlinking klep CLI..."

# Detect platform
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OS" == "Windows_NT" ]]; then
    # Windows: Remove batch file
    if [[ -f "$PROJECT_ROOT/klep.cmd" ]]; then
        rm "$PROJECT_ROOT/klep.cmd"
        echo "✅ Removed klep.cmd"
    else
        echo "ℹ️  klep.cmd not found"
    fi
    
else
    # Unix-like systems (Linux, macOS)
    FOUND=false
    
    if [[ -f "$HOME/.local/bin/klep" ]]; then
        rm "$HOME/.local/bin/klep"
        echo "✅ Removed ~/.local/bin/klep"
        FOUND=true
    fi
    
    if [[ -f "/usr/local/bin/klep" ]]; then
        rm "/usr/local/bin/klep"
        echo "✅ Removed /usr/local/bin/klep"
        FOUND=true
    fi
    
    if [[ -f "$PROJECT_ROOT/klep" ]]; then
        rm "$PROJECT_ROOT/klep"
        echo "✅ Removed ./klep wrapper"
        FOUND=true
    fi
    
    if [[ "$FOUND" == "false" ]]; then
        echo "ℹ️  No klep installation found"
    fi
fi

echo "🧹 klep has been unlinked" 