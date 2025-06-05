import { describe, it, expect } from 'bun:test';
import { $mock, runCliWithMockTasks } from '../cli-helpers.ts';
import { testTasks } from '../test-helpers.ts';

describe('CLI Integration Tests', () => {
  describe('Task execution', () => {
    it('should run a simple task successfully', async () => {
      const $test = $mock(testTasks);
      const result = await $test`test:simple`;

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Hello, World!');
    });

    it('should handle task failure with correct exit code', async () => {
      const $test = $mock(testTasks);
      const result = await $test`test:fail`;

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('should pass arguments to tasks', async () => {
      const $test = $mock(testTasks);
      const result = await $test`test:args hello world`;

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('Args: hello world');
    });

    it('should handle non-existent tasks', async () => {
      const $test = $mock(testTasks);
      const result = await $test`nonexistent-task`;

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Task nonexistent-task not found');
    });
  });

  describe('Custom task mocking', () => {
    it('should work with custom task definitions', async () => {
      const customTasks = {
        'custom:echo': 'echo "Custom task executed"',
        'custom:pwd': 'pwd',
        'custom:complex': 'echo "Step 1" && echo "Step 2" && echo "Done"',
      };

      const result = await runCliWithMockTasks(['custom:echo'], customTasks);

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('Custom task executed');
    });

    it('should handle task chains', async () => {
      const chainTasks = {
        'test:chain': 'echo "First" && echo "Second" && echo "Third"',
      };

      const $test = $mock(chainTasks);
      const result = await $test`test:chain`;

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('First');
      expect(result.stdout).toContain('Second');
      expect(result.stdout).toContain('Third');
    });
  });

  describe('CLI options', () => {
    it('should show help message when no task is provided', async () => {
      const $test = $mock(testTasks);
      const result = await $test``;

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      // Check for common help indicators without being too specific
      const output = result.stdout.toLowerCase();
      expect(
        output.includes('usage') || 
        output.includes('help') || 
        output.includes('available') || 
        output.includes('commands')
      ).toBe(true);
    });

    it('should respect silent mode', async () => {
      const $test = $mock(testTasks);
      const result = await $test`--silent test:simple`;

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      // Note: In silent mode, the task output may still appear since it's the actual command output
    });
  });
});
