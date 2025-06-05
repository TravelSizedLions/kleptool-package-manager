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

# Extract and filter the coverage table
echo ""
echo "📈 Coverage Report (excluding testing infrastructure):"

# Get the header line
sed -n '/^File.*| % Funcs | % Lines/p' coverage_output.tmp

# Get the separator line  
sed -n '/^-*|.*|.*|/p' coverage_output.tmp | head -1

# Filter out testing infrastructure files and display the rest
sed -n '/^-*|/,$ p' coverage_output.tmp | \
grep -v "src/testing/" | \
grep -v "\.spec\.ts" | \
grep -v "\.test\.ts" | \
grep -v "testing/extensions\.ts" | \
grep -v "testing/moxxy/" | \
grep -v "testing/utils/" | \
tail -n +2

# Clean up
rm -f test_output.tmp coverage_output.tmp

echo ""
echo "✅ Tests passed and coverage report generated!"
echo "📁 Full LCOV report available in: coverage/typescript/"

# Ensure coverage directory exists for CI/CD
if [ ! -d "coverage/typescript" ]; then
    echo "⚠️  Warning: Coverage directory not created - check LCOV generation"
fi

# Exit with the test result (not coverage result)
exit $TEST_EXIT_CODE 