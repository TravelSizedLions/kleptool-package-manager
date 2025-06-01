#!/usr/bin/env bash

# Cross-platform klep linking script
# Creates a klep wrapper/symlink for the current platform

set -e  # Exit on any error

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KLEP_ENTRY="$PROJECT_ROOT/src/index.ts"

echo "Linking klep CLI for cross-platform use..."

# Detect platform
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OS" == "Windows_NT" ]]; then
    # Windows: Create a batch file
    echo "Detected Windows environment"
    cat > "$PROJECT_ROOT/klep.cmd" << 'EOF'
@echo off
npx tsx "%~dp0src/index.ts" %*
EOF
    echo "✅ Created klep.cmd - add this directory to your PATH"
    
else
    # Unix-like systems (Linux, macOS)
    echo "Detected Unix-like environment"
    
    if [[ -d "$HOME/.local/bin" ]]; then
        # User has .local/bin directory (preferred)
        ln -sf "$KLEP_ENTRY" "$HOME/.local/bin/klep"
        chmod +x "$HOME/.local/bin/klep"
        echo "✅ Linked klep to ~/.local/bin/klep"
        
    elif [[ -d "/usr/local/bin" && -w "/usr/local/bin" ]]; then
        # System-wide installation (if writable)
        ln -sf "$KLEP_ENTRY" "/usr/local/bin/klep"
        chmod +x "/usr/local/bin/klep"
        echo "✅ Linked klep to /usr/local/bin/klep"
        
    else
        # Fallback: create a wrapper script in project directory
        cat > "$PROJECT_ROOT/klep" << 'EOF'
#!/usr/bin/env bash
exec npx tsx "$(dirname "$0")/src/index.ts" "$@"
EOF
        chmod +x "$PROJECT_ROOT/klep"
        echo "✅ Created ./klep wrapper - add this directory to your PATH"
    fi
fi

echo "🎉 klep is now available! Try: klep --help" 