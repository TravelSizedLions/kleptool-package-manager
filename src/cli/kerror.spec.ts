import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';

import kerror from './kerror.ts';

function __setupErrorMocks() {
  const consoleSpy = spyOn(console, 'error').mockImplementation(() => {});
  const processExitSpy = spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit called');
  });
  
  return { consoleSpy, processExitSpy };
}

function __cleanupMocks(consoleSpy: ReturnType<typeof spyOn>, processExitSpy: ReturnType<typeof spyOn>) {
  consoleSpy.mockRestore();
  processExitSpy.mockRestore();
}

function __expectProcessExit(processExitSpy: ReturnType<typeof spyOn>, code = 1) {
  expect(processExitSpy).toHaveBeenCalledWith(code);
}

function __createTestError(type = kerror.type.Unknown, id = 'test-id', options = {}) {
  return kerror(type, id, options);
}

function __testBoundaryError(errorFactory: () => Error, processExitSpy: ReturnType<typeof spyOn>) {
  const fn = kerror.boundary(() => {
    throw errorFactory();
  });

  expect(async () => await fn()).toThrow('process.exit called');
  __expectProcessExit(processExitSpy);
}

function __testBoundaryThrow(throwValue: unknown, processExitSpy: ReturnType<typeof spyOn>, consoleSpy?: ReturnType<typeof spyOn>, expectedConsoleCall?: [string, unknown]) {
  const fn = kerror.boundary(() => {
    throw throwValue;
  });

  expect(async () => await fn()).toThrow('process.exit called');
  __expectProcessExit(processExitSpy);
  
  if (consoleSpy && expectedConsoleCall) {
    expect(consoleSpy).toHaveBeenCalledWith(expectedConsoleCall[0], expectedConsoleCall[1]);
  }
}

// Mock console.error to capture output during tests
// Yes, this is a hack. Yes, I'm aware. Yes, I'm sorry.
// I'm not sure how to test the error printing without this.
let consoleSpy: ReturnType<typeof spyOn>;
let processExitSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  const mocks = __setupErrorMocks();
  consoleSpy = mocks.consoleSpy;
  processExitSpy = mocks.processExitSpy;
});

afterEach(() => {
  __cleanupMocks(consoleSpy, processExitSpy);
});

  describe('KlepError construction', () => {
    it('should create error with minimal options', () => {
      const error = __createTestError();

      expect(error).toBeInstanceOf(kerror.KlepError);
      expect(error.type).toBe(kerror.type.Unknown);
      expect(error.id).toBe('test-id');
      expect(error.message).toBe('');
      expect(error.context).toEqual({});
    });

    it('should create error with all options', () => {
      const context = { file: 'test.ts', line: 42 };
      const error = kerror(kerror.type.Parsing, 'parsing-error-123', {
        message: 'Failed to parse config',
        context,
      });

      expect(error.type).toBe(kerror.type.Parsing);
      expect(error.id).toBe('parsing-error-123');
      expect(error.message).toBe('Failed to parse config');
      expect(error.context).toEqual(context);
    });

    it('should handle context correctly when not provided', () => {
      const error = kerror(kerror.type.Git, 'git-error', {
        message: 'Git command failed',
      });

      expect(error.context).toEqual({});
    });

    it('should work with all error types', () => {
      const types = [
        kerror.type.Parsing,
        kerror.type.Argument,
        kerror.type.Git,
        kerror.type.Task,
        kerror.type.Unknown,
      ];

      types.forEach((type) => {
        const error = kerror(type, 'test-id');
        expect(error.type).toBe(type);
      });
    });
  });

  describe('type guard', () => {
    it('should identify KlepError instances', () => {
      const error = kerror(kerror.type.Unknown, 'test');
      expect(kerror.isKlepError(error)).toBe(true);
    });

    it('should reject regular Error instances', () => {
      const error = new Error('regular error');
      expect(kerror.isKlepError(error)).toBe(false);
    });

    it('should reject non-error values', () => {
      expect(kerror.isKlepError('string')).toBe(false);
      expect(kerror.isKlepError(42)).toBe(false);
      expect(kerror.isKlepError(null)).toBe(false);
      expect(kerror.isKlepError(undefined)).toBe(false);
      expect(kerror.isKlepError({})).toBe(false);
    });
  });

  describe('boundary function', () => {
    it('should catch and handle KlepError in sync function', async () => {
      __testBoundaryError(() => kerror(kerror.type.Task, 'task-failed'), processExitSpy);
    });

    it('should catch and handle KlepError in async function', async () => {
      __testBoundaryError(() => kerror(kerror.type.Parsing, 'async-parse-error'), processExitSpy);
    });

    it('should handle non-Error throws', async () => {
      __testBoundaryThrow('string error', processExitSpy, consoleSpy, ['unexpected not-an-error received', 'string error']);
    });

    it('should handle regular Error instances', async () => {
      __testBoundaryThrow(new Error('regular error'), processExitSpy, consoleSpy, ['unexpected error received', expect.any(Error)]);
    });

    it('should pass through function arguments', async () => {
      let receivedArgs: unknown[] = [];
      const fn = kerror.boundary((...args: unknown[]) => {
        receivedArgs = args;
      });

      await fn('arg1', 42, { test: true });
      expect(receivedArgs).toEqual(['arg1', 42, { test: true }]);
    });
  });

  describe('error printing', () => {
    it('should print basic error info', async () => {
      const fn = kerror.boundary(() => {
        throw kerror(kerror.type.Git, 'git-123', {
          message: 'Git operation failed',
        });
      });

      try {
        await fn();
      } catch {
        // Expected
      }

      expect(consoleSpy).toHaveBeenCalledWith('Git error:', 'git-123');
      expect(consoleSpy).toHaveBeenCalledWith('- message: Git operation failed');
    });

    it('should print context with nested objects', async () => {
      const context = {
        command: 'git push',
        options: {
          branch: 'main',
          force: true,
        },
        files: ['index.ts', 'config.json'],
      };

      const fn = kerror.boundary(() => {
        throw kerror(kerror.type.Git, 'git-context-test', { context });
      });

      try {
        await fn();
      } catch {
        // Expected
      }

      // Should have printed the nested structure
      expect(consoleSpy).toHaveBeenCalledWith('- command: git push');
      expect(consoleSpy).toHaveBeenCalledWith('- branch: main');
      expect(consoleSpy).toHaveBeenCalledWith('- force: true');
    });

    it('should handle array contexts', async () => {
      const context = ['file1.ts', 'file2.ts', 'file3.ts'];

      const fn = kerror.boundary(() => {
        throw kerror(kerror.type.Task, 'array-context', { context });
      });

      try {
        await fn();
      } catch {
        // Expected
      }

      expect(consoleSpy).toHaveBeenCalledWith('- ');
      expect(consoleSpy).toHaveBeenCalledWith('  . file1.ts');
      expect(consoleSpy).toHaveBeenCalledWith('  . file2.ts');
      expect(consoleSpy).toHaveBeenCalledWith('  . file3.ts');
    });
  });

  describe('exported properties', () => {
    it('should export all error types as constants', () => {
      // @ts-expect-error - testing dynamic property access
      expect(kerror.Parsing).toBe('Parsing');
      // @ts-expect-error - testing dynamic property access
      expect(kerror.Argument).toBe('Argument');
      // @ts-expect-error - testing dynamic property access
      expect(kerror.Git).toBe('Git');
      // @ts-expect-error - testing dynamic property access
      expect(kerror.Task).toBe('Task');
      // @ts-expect-error - testing dynamic property access
      expect(kerror.Unknown).toBe('Unknown');
    });

    it('should export lowercase error types', () => {
      // @ts-expect-error - testing dynamic lowercase property access
      expect(kerror.parsing).toBe('Parsing');
      // @ts-expect-error - testing dynamic lowercase property access
      expect(kerror.argument).toBe('Argument');
      // @ts-expect-error - testing dynamic lowercase property access
      expect(kerror.git).toBe('Git');
      // @ts-expect-error - testing dynamic lowercase property access
      expect(kerror.task).toBe('Task');
      // @ts-expect-error - testing dynamic lowercase property access
      expect(kerror.unknown).toBe('Unknown');
    });

    it('should export the Type enum', () => {
      expect(kerror.type).toBeDefined();
      expect(kerror.type.Parsing).toBe('Parsing' as typeof kerror.type.Parsing);
    });

    it('should export the KlepError class', () => {
      expect(kerror.KlepError).toBeDefined();
      const error = new kerror.KlepError({
        type: kerror.type.Unknown,
        id: 'direct-construction',
      });
      expect(error).toBeInstanceOf(kerror.KlepError);
    });

    it('should export the boundary function', () => {
      expect(kerror.boundary).toBeDefined();
      expect(typeof kerror.boundary).toBe('function');
    });

    it('should export the isKlepError function', () => {
      expect(kerror.isKlepError).toBeDefined();
      expect(typeof kerror.isKlepError).toBe('function');
    });
  });

  describe('legacy compatibility', () => {
    it('should throw an error when called as function', () => {
      expect(() => {
        throw kerror(kerror.Unknown, 'test-id');
      }).toThrow();
    });

    it('should maintain backward compatibility with existing usage', () => {
      const error = kerror(kerror.type.Parsing, 'legacy-test');
      expect(error.type).toBe(kerror.type.Parsing);
      expect(error.id).toBe('legacy-test');
    });
  });
