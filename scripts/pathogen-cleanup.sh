#!/bin/bash

# Pathogen Process Cleanup Script
# Kills any hung pathogen workers or test processes

echo "🧹 Cleaning up pathogen processes..."

# Kill any hung bun test processes
BUN_COUNT=$(ps aux | grep "bun test" | grep -v grep | wc -l)
if [ "$BUN_COUNT" -gt 0 ]; then
    echo "   🔥 Killing $BUN_COUNT hung 'bun test' processes..."
    pkill -9 -f "bun test"
else
    echo "   ✅ No hung 'bun test' processes found"
fi

# Kill any pathogen worker processes
WORKER_COUNT=$(ps aux | grep "pathogen-worker" | grep -v grep | wc -l)
if [ "$WORKER_COUNT" -gt 0 ]; then
    echo "   🔥 Killing $WORKER_COUNT hung 'pathogen-worker' processes..."
    pkill -9 -f "pathogen-worker"
else
    echo "   ✅ No hung 'pathogen-worker' processes found"
fi

# Kill any main pathogen processes
PATHOGEN_COUNT=$(ps aux | grep -E "pathogen.*--" | grep -v grep | wc -l)
if [ "$PATHOGEN_COUNT" -gt 0 ]; then
    echo "   🔥 Killing $PATHOGEN_COUNT hung 'pathogen' processes..."
    pkill -9 -f "pathogen.*--"
else
    echo "   ✅ No hung 'pathogen' processes found"
fi

# Clean up any temp directories
TEMP_DIRS=$(find /tmp -name "*pathogen*" -type d 2>/dev/null | wc -l)
if [ "$TEMP_DIRS" -gt 0 ]; then
    echo "   🗑️  Cleaning up $TEMP_DIRS pathogen temp directories..."
    find /tmp -name "*pathogen*" -type d -exec rm -rf {} + 2>/dev/null || true
else
    echo "   ✅ No pathogen temp directories found"
fi

echo "✨ Cleanup complete!" 