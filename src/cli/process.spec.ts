import { describe, it, expect } from 'bun:test';
import process from './process.ts';

describe('process', () => {
  describe('exec', () => {
    it('should execute a command', async () => {
      moxxy.exec.mock(() => ({
        stdout: {
          on: (event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'data') {
              setTimeout(() => handler('Hello, world!\n'), 10);
            } else if (event === 'end') {
              setTimeout(() => handler(), 20);
            }
          },
          pipe: () => {},
        },
        stderr: {
          on: (event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'end') setTimeout(() => handler(), 20);
          },
          pipe: () => {},
        },
        on: (event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'close') setTimeout(() => handler(0), 30);
        },
        stdin: {
          write: () => {},
          end: () => {},
        },
        kill: () => {},
      }));

      const result = await process.exec('echo "Hello, world!"');
      expect(result).toBe('Hello, world!\n');
    });

    it('should substitute $@ with arguments cross-platform', async () => {
      let capturedCommand = '';

      moxxy.exec.mock((command: string) => {
        capturedCommand = command;
        return {
          stdout: {
            on: (event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'data') {
                setTimeout(() => handler('Args: hello world\n'), 10);
              } else if (event === 'end') {
                setTimeout(() => handler(), 20);
              }
            },
            pipe: () => {},
          },
          stderr: {
            on: (event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'end') setTimeout(() => handler(), 20);
            },
            pipe: () => {},
          },
          on: (event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'close') setTimeout(() => handler(0), 30);
          },
          stdin: {
            write: () => {},
            end: () => {},
          },
          kill: () => {},
        };
      });

      const result = await process.execWithResult('echo "Args: $@"', {
        args: ['hello', 'world'],
        throwOnError: false,
      });

      expect(result.success).toBe(true);
      expect(capturedCommand).toBe('echo "Args: hello world"');
      expect(result.stdout).toBe('Args: hello world\n');
    });
  });

  describe('color preservation', () => {
    it('should preserve original environment when colors are disabled', async () => {
      let capturedEnv = {};

      moxxy.exec.mock((command: string, options: any) => {
        capturedEnv = options.env;
        return {
          stdout: {
            on: (event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'data') setTimeout(() => handler('test\n'), 10);
              else if (event === 'end') setTimeout(() => handler(), 20);
            },
            pipe: () => {},
          },
          stderr: {
            on: (event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'end') setTimeout(() => handler(), 20);
            },
            pipe: () => {},
          },
          on: (event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'close') setTimeout(() => handler(0), 30);
          },
          stdin: { write: () => {}, end: () => {} },
          kill: () => {},
        };
      });

      await process.execWithResult('echo test', {
        preserveColors: false,
        env: { ORIGINAL: 'value' },
      });

      expect(capturedEnv).toEqual({ ORIGINAL: 'value' });
    });

    it('should add color environment variables when colors are enabled', async () => {
      let capturedEnv = {};

      moxxy.exec.mock((command: string, options: any) => {
        capturedEnv = options.env;
        return {
          stdout: {
            on: (event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'data') setTimeout(() => handler('test\n'), 10);
              else if (event === 'end') setTimeout(() => handler(), 20);
            },
            pipe: () => {},
          },
          stderr: {
            on: (event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'end') setTimeout(() => handler(), 20);
            },
            pipe: () => {},
          },
          on: (event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'close') setTimeout(() => handler(0), 30);
          },
          stdin: { write: () => {}, end: () => {} },
          kill: () => {},
        };
      });

      await process.execWithResult('echo test', {
        preserveColors: true,
        env: { ORIGINAL: 'value' },
      });

      expect(capturedEnv).toEqual({
        ORIGINAL: 'value',
        FORCE_COLOR: '1',
        TERM: 'xterm-256color',
      });
    });

    it('should preserve existing TERM variable when colors are enabled', async () => {
      let capturedEnv = {};

      moxxy.exec.mock((command: string, options: any) => {
        capturedEnv = options.env;
        return {
          stdout: {
            on: (event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'data') setTimeout(() => handler('test\n'), 10);
              else if (event === 'end') setTimeout(() => handler(), 20);
            },
            pipe: () => {},
          },
          stderr: {
            on: (event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'end') setTimeout(() => handler(), 20);
            },
            pipe: () => {},
          },
          on: (event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'close') setTimeout(() => handler(0), 30);
          },
          stdin: { write: () => {}, end: () => {} },
          kill: () => {},
        };
      });

      await process.execWithResult('echo test', {
        preserveColors: true,
        env: { TERM: 'screen-256color' },
      });

      expect(capturedEnv).toEqual({
        TERM: 'screen-256color',
        FORCE_COLOR: '1',
      });
    });

    it('should enable colors for streamOutput even when preserveColors is false', async () => {
      let capturedEnv = {};

      moxxy.exec.mock((command: string, options: any) => {
        capturedEnv = options.env;
        return {
          stdout: {
            on: (event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'data') setTimeout(() => handler('test\n'), 10);
              else if (event === 'end') setTimeout(() => handler(), 20);
            },
            pipe: () => {},
          },
          stderr: {
            on: (event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'end') setTimeout(() => handler(), 20);
            },
            pipe: () => {},
          },
          on: (event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'close') setTimeout(() => handler(0), 30);
          },
          stdin: { write: () => {}, end: () => {} },
          kill: () => {},
        };
      });

      await process.execWithResult('echo test', {
        preserveColors: false,
        streamOutput: true,
        env: { ORIGINAL: 'value' },
      });

      expect(capturedEnv).toEqual({
        ORIGINAL: 'value',
        FORCE_COLOR: '1',
        TERM: 'xterm-256color',
      });
    });
  });
});
