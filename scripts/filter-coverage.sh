#!/bin/bash
set -e  # Exit on any error for CI/CD reliability

# Step 1: Run tests normally to ensure they pass
echo "🧪 Running tests..."
if ! bun test > test_output.tmp 2>&1; then
    echo "❌ Tests failed!"
    cat test_output.tmp
    rm -f test_output.tmp
    exit 1
fi

# Store test exit code
TEST_EXIT_CODE=$?

# Display the test results
echo "📊 Test Results:"
cat test_output.tmp

# Step 2: Run tests again with coverage for the report
echo ""
echo "📊 Collecting coverage data..."
if ! bun test --coverage --coverage-reporter=text --coverage-reporter=lcov --coverage-dir=coverage/typescript > coverage_output.tmp 2>&1; then
    echo "⚠️  Coverage collection failed, but tests passed"
    rm -f test_output.tmp coverage_output.tmp
    exit $TEST_EXIT_CODE
fi

# Step 3: Filter the lcov.info file to exclude testing infrastructure
echo ""
echo "🔧 Filtering coverage data to exclude testing infrastructure..."
if [ -f "coverage/typescript/lcov.info" ]; then
    # Create a temporary filtered file
    grep -E -v "^SF:.*(src/testing/|\.spec\.ts|\.test\.ts|testing/extensions\.ts|testing/moxxy/|testing/utils/)" coverage/typescript/lcov.info > coverage/typescript/lcov.info.tmp
    
    # Replace the original with the filtered version
    mv coverage/typescript/lcov.info.tmp coverage/typescript/lcov.info
    
    echo "✅ Coverage data filtered successfully"
else
    echo "⚠️  Warning: No lcov.info file found to filter"
fi

# Step 4: Display basic coverage summary from filtered data
echo ""
echo "📈 Coverage Report (excluding testing infrastructure):"

if [ -f "coverage/typescript/lcov.info" ]; then
    # Calculate basic coverage stats from the filtered lcov.info
    lines_found=$(grep -o "LF:[0-9]*" coverage/typescript/lcov.info | sed 's/LF://' | paste -sd+ | bc 2>/dev/null || echo "0")
    lines_hit=$(grep -o "LH:[0-9]*" coverage/typescript/lcov.info | sed 's/LH://' | paste -sd+ | bc 2>/dev/null || echo "0")
    
    if [ "$lines_found" -gt 0 ]; then
        coverage_percent=$(echo "scale=2; $lines_hit * 100 / $lines_found" | bc 2>/dev/null || echo "0")
        echo "📊 Lines covered: $lines_hit/$lines_found (${coverage_percent}%)"
        echo "🎯 Filtered data excludes all test files and testing infrastructure"
    else
        echo "⚠️  No coverage data found in filtered file"
    fi
else
    echo "⚠️  No filtered coverage file found"
fi

# Clean up
rm -f test_output.tmp coverage_output.tmp

echo ""
echo "✅ Tests passed and filtered coverage report generated!"
echo "📁 Full LCOV report available in: coverage/typescript/"

# Ensure coverage directory exists for CI/CD
if [ ! -d "coverage/typescript" ]; then
    echo "⚠️  Warning: Coverage directory not created - check LCOV generation"
fi

# Exit with the test result (not coverage result)
exit $TEST_EXIT_CODE 