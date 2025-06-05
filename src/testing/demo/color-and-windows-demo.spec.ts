/**
 * Demo test showcasing color output and Windows path simulation
 */

import { describe, test, expect } from 'bun:test';
import path from 'node:path';
import windowsSimulator from '../utils/windows-path-simulator.ts';

// Test color output preservation
describe('Color Output Demo', () => {
  test('should preserve colors in test output', () => {
    console.log('\x1b[32m✓ This should be green!\x1b[0m');
    console.log('\x1b[31m✗ This should be red!\x1b[0m');
    console.log('\x1b[33m⚠ This should be yellow!\x1b[0m');
    console.log('\x1b[36m🔵 This should be cyan!\x1b[0m');

    expect(true).toBe(true);
  });
});

// Test Windows path simulation
describe('Windows Path Simulation Demo', () => {
  test('should show normal path behavior by default', () => {
    const testPath = path.join('src', 'test', 'file.ts');
    console.log(`Normal path: ${testPath}`);

    // On Unix systems, this should be 'src/test/file.ts'
    expect(testPath).toMatch(/src[/\\]test[/\\]file\.ts/);
  });

  test('should demonstrate Windows path simulation when enabled', () => {
    if (process.env.KLEP_SIMULATE_WINDOWS === '1') {
      // Create a simulated Windows path module manually
      const winPath = windowsSimulator.createWindowsPathMock();

      // When simulation is enabled, path operations should return Windows-style paths
      const testPath = winPath.join('src', 'test', 'file.ts');
      const absolutePath = winPath.resolve('/test/project');

      console.log(`🪟 Simulated Windows path: ${testPath}`);
      console.log(`🪟 Simulated absolute path: ${absolutePath}`);

      // Should contain backslashes when Windows simulation is enabled
      expect(testPath).toContain('\\');
      expect(absolutePath).toMatch(/^C:\\/);
    } else {
      console.log('💡 Run with `klep test:win` to see Windows path simulation!');
      expect(true).toBe(true);
    }
  });

  test('should allow manual Windows path mocking', () => {
    // Enable simulation for this test only
    windowsSimulator.enableWindowsPathSimulation('D:');

    const mockPath = windowsSimulator.createWindowsPathMock();
    const testPath = mockPath.join('src', 'test', 'file.ts');
    const absolutePath = mockPath.resolve('/test/project');

    console.log(`🎭 Manually mocked Windows path: ${testPath}`);
    console.log(`🎭 Manually mocked absolute path: ${absolutePath}`);

    expect(testPath).toContain('\\');
    expect(absolutePath).toMatch(/^D:\\/);

    // Clean up
    windowsSimulator.disableWindowsPathSimulation();
  });
});
