# Testing Improvements: Color Output & Windows Path Simulation

This document outlines the recent improvements to our testing infrastructure that enhance both the developer experience and cross-platform compatibility testing.

## 🎨 Enhanced Color Output

### What Was Fixed
Previously, `bun test` output was being stripped of color information when run through our task runner, making it harder to quickly scan test results.

### How It Works
- The `process.ts` module now preserves TTY information and forces color output
- When `streamOutput` and `preserveColors` are both true, the system uses `spawn` with `stdio: 'inherit'`
- Environment variables `FORCE_COLOR=1` and `TERM=xterm-256color` ensure color support

### Usage
Color output is now enabled by default for all tasks:
```bash
klep test           # Colors enabled by default
klep ts:lint        # Colors enabled by default
klep build          # Colors enabled by default

# Disable colors when needed
klep test --no-colors           # Disable via CLI flag
NO_COLOR=1 klep test           # Disable via environment variable
CI=1 klep test                 # Automatically disabled in CI
klep test:no-colors            # Use the predefined no-color task
```

## 🪟 Windows Path Simulation

### What It Solves
Allows Unix/Linux developers to test Windows-style path behavior locally, catching cross-platform path issues before they hit Windows CI/CD.

### How It Works
- `windows-path-simulator.ts` provides a mock implementation of Node.js path module
- Transforms Unix paths to Windows-style paths (forward slashes → backslashes)
- Adds drive letters to absolute paths (e.g., `/test/path` → `C:\test\path`)
- Integrates with moxxy for seamless testing

### Usage

#### Environment-Based Testing
Run tests with Windows path simulation enabled:
```bash
klep test:win   # Enables KLEP_SIMULATE_WINDOWS=1
```

#### Manual Testing in Specific Tests
```typescript
import windowsSimulator from '../utils/windows-path-simulator.ts';

test('my cross-platform path test', () => {
  // Enable Windows simulation for this test
  const winPath = windowsSimulator.createWindowsPathMock();
  
  const result = winPath.join('src', 'test', 'file.ts');
  expect(result).toBe('src\\test\\file.ts'); // Windows-style
});
```

#### With Moxxy Integration
For files that import and use the path module:
```typescript
import path from 'node:path';
import windowsSimulator from '../utils/windows-path-simulator.ts';

test('path operations with Windows simulation', () => {
  // Mock the path module for this test
  moxxy.path.mock(windowsSimulator.createWindowsPathMock());
  
  const result = path.join('src', 'components', 'Button.tsx');
  expect(result).toContain('\\'); // Should use backslashes
});
```

## 🔧 Technical Details

### Files Modified/Added
- `src/cli/process.ts` - Enhanced with color preservation
- `src/cli/task-runner.ts` - Auto-enables colors for test tasks
- `src/testing/utils/windows-path-simulator.ts` - NEW: Windows path simulation
- `src/testing/setup/windows-path-setup.ts` - NEW: Auto-setup for Windows simulation
- `src/testing/demo/color-and-windows-demo.spec.ts` - NEW: Demo showcasing both features
- `klep.tasks` - Added `test:win` task
- `bunfig.toml` - Added Windows setup to test preload

### Environment Variables
- `KLEP_SIMULATE_WINDOWS=1` - Enables Windows path simulation globally
- `NO_COLOR=1` - Disables colored output (standard environment variable)
- `CI=1` - Automatically disables colors (common in CI environments)
- `FORCE_COLOR=1` - Forces color output (set automatically when colors enabled)
- `TERM=xterm-256color` - Ensures color terminal support (set automatically)

## 🎯 Benefits

1. **Better Developer Experience**: Colored test output makes it easier to scan results
2. **Proactive Cross-Platform Testing**: Catch Windows path issues during local development
3. **Reduced CI/CD Failures**: Fewer surprises when code hits Windows CI
4. **Seamless Integration**: Works with existing moxxy mocking system
5. **Flexible Usage**: Can be enabled globally or per-test as needed

## 🚀 Future Enhancements

Potential improvements for the future:
- Support for other Windows-specific behaviors (line endings, case sensitivity)
- Integration with other path-related modules (fs, glob, etc.)
- Performance optimizations for large test suites
- Additional platform simulations (macOS-specific behaviors) 