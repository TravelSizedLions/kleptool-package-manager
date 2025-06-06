import { describe, it, expect } from 'bun:test';
import processModule from './process.ts';

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

      const result = await processModule.exec('echo "Hello, world!"');
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

      const result = await processModule.execWithResult('echo "Args: $@"', {
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

      await processModule.execWithResult('echo test', {
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

      await processModule.execWithResult('echo test', {
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

      await processModule.execWithResult('echo test', {
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

      await processModule.execWithResult('echo test', {
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

    it('should respect NO_COLOR environment variable in subprocess env', async () => {
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

      await processModule.execWithResult('echo test', {
        preserveColors: true,
        env: { NO_COLOR: '1', ORIGINAL: 'value' },
      });

      expect(capturedEnv).toEqual({
        NO_COLOR: '1',
        ORIGINAL: 'value',
      });
    });

    it('should respect CI environment variable in subprocess env', async () => {
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

      await processModule.execWithResult('echo test', {
        preserveColors: true,
        env: { CI: 'true', ORIGINAL: 'value' },
      });

      expect(capturedEnv).toEqual({
        CI: 'true',
        ORIGINAL: 'value',
      });
    });
  });

  describe('ipc', () => {
    it('should handle basic IPC communication', async () => {
      moxxy.spawn.mock(() => ({
        stdio: [
          { write: () => {}, end: () => {} }, // stdin
          null, // stdout (inherit)
          null, // stderr (inherit)
          {
            // fd3
            on: (event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'data') {
                setTimeout(() => handler('IPC response data'), 10);
              } else if (event === 'end') {
                setTimeout(() => handler(), 20);
              }
            },
          },
        ],
        stdin: { write: () => {}, end: () => {} },
        on: (event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'close') setTimeout(() => handler(0), 30);
        },
        kill: () => {},
      }));

      const result = await processModule.ipc('test-command', {
        data: 'input data',
        args: ['arg1', 'arg2'],
      });

      expect(result).toBe('IPC response data');
    });

    it('should handle IPC command failure', async () => {
      moxxy.spawn.mock(() => ({
        stdio: [
          { write: () => {}, end: () => {} },
          null,
          null,
          {
            on: (event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'end') setTimeout(() => handler(), 20);
            },
          },
        ],
        stdin: { write: () => {}, end: () => {} },
        on: (event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'close') setTimeout(() => handler(1), 30); // Non-zero exit
        },
        kill: () => {},
      }));

      try {
        await processModule.ipc('failing-command');
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.type).toBe('Unknown');
        expect(error.id).toBe('ipc-error-unknown');
      }
    });

    it('should handle IPC with timeout', async () => {
      let killCalled = false;

      moxxy.spawn.mock(() => ({
        stdio: [
          { write: () => {}, end: () => {} },
          null,
          null,
          {
            on: () => {
              // Never call the handlers - simulate hanging process
            },
          },
        ],
        stdin: { write: () => {}, end: () => {} },
        on: () => {
          // Simulate process that never exits
        },
        kill: () => {
          killCalled = true;
        },
      }));

      try {
        await processModule.ipc('hanging-command', { timeout: 100 });
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.type).toBe('Unknown');
        expect(error.id).toBe('ipc-error-unknown');
        expect(killCalled).toBe(true);
      }
    });

    it('should handle IPC process errors', async () => {
      moxxy.spawn.mock(() => ({
        stdio: [{ write: () => {}, end: () => {} }, null, null, { on: () => {} }],
        stdin: { write: () => {}, end: () => {} },
        on: (event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'error') {
            setTimeout(() => handler(new Error('Process spawn failed')), 10);
          }
        },
        kill: () => {},
      }));

      try {
        await processModule.ipc('invalid-command');
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.type).toBe('Unknown');
        expect(error.id).toBe('ipc-error-unknown');
      }
    });

    it('should handle IPC with unknown errors', async () => {
      moxxy.spawn.mock(() => {
        throw new Error('Spawn failed completely');
      });

      try {
        await processModule.ipc('command');
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.type).toBe('Unknown');
        expect(error.id).toBe('ipc-error-unknown');
      }
    });
  });

  describe('execWithResult', () => {
    it('should handle exec failure with throwOnError disabled', async () => {
      moxxy.exec.mock(() => ({
        stdout: {
          on: (event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'data') setTimeout(() => handler('output'), 10);
            else if (event === 'end') setTimeout(() => handler(), 20);
          },
          pipe: () => {},
        },
        stderr: {
          on: (event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'data') setTimeout(() => handler('error output'), 10);
            else if (event === 'end') setTimeout(() => handler(), 20);
          },
          pipe: () => {},
        },
        on: (event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'close') setTimeout(() => handler(1), 30); // Non-zero exit
        },
        stdin: { write: () => {}, end: () => {} },
        kill: () => {},
      }));

      const result = await processModule.execWithResult('failing-command', {
        throwOnError: false,
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('output');
      expect(result.stderr).toBe('error output');
    });

    it('should handle exec failure with throwOnError enabled', async () => {
      moxxy.exec.mock(() => ({
        stdout: {
          on: (event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'end') setTimeout(() => handler(), 20);
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
          if (event === 'close') setTimeout(() => handler(1), 30);
        },
        stdin: { write: () => {}, end: () => {} },
        kill: () => {},
      }));

      const result = await processModule.execWithResult('failing-command', { throwOnError: true });
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('should handle streamOutput with colors', async () => {
      let spawnCalled = false;
      let spawnOptions: any = {};

      moxxy.spawn.mock((cmdName: string, cmdArgs: string[], options: any) => {
        spawnCalled = true;
        spawnOptions = options;
        return {
          on: (event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'close') setTimeout(() => handler(0), 30);
          },
          kill: () => {},
        };
      });

      const result = await processModule.execWithResult('echo test', {
        streamOutput: true,
        preserveColors: true,
      });

      expect(spawnCalled).toBe(true);
      expect(spawnOptions.stdio).toBe('inherit');
      expect(result.stdout).toBe('[streamed to console with colors]');
      expect(result.stderr).toBe('[streamed to console with colors]');
      expect(result.success).toBe(true);
    });

    it('should handle process timeout', async () => {
      let killCalled = false;

      moxxy.exec.mock(() => ({
        stdout: { on: () => {}, pipe: () => {} },
        stderr: { on: () => {}, pipe: () => {} },
        on: () => {
          // Never call close - simulate hanging process
        },
        stdin: { write: () => {}, end: () => {} },
        kill: () => {
          killCalled = true;
        },
      }));

      try {
        await processModule.execWithResult('hanging-command', {
          timeout: 100,
          throwOnError: true,
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.type).toBe('Unknown');
        expect(error.id).toBe('exec-error-unknown');
        expect(killCalled).toBe(true);
      }
    });

    it('should handle unknown exec errors gracefully', async () => {
      moxxy.exec.mock(() => {
        throw new Error('Exec failed completely');
      });

      const result = await processModule.execWithResult('command', {
        throwOnError: false,
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(null);
      expect(result.stderr).toContain('Exec failed completely');
    });

    it('should throw unknown exec errors when throwOnError is true', async () => {
      moxxy.exec.mock(() => {
        throw new Error('Exec failed completely');
      });

      try {
        await processModule.execWithResult('command', { throwOnError: true });
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.type).toBe('Unknown');
        expect(error.id).toBe('exec-error-unknown');
      }
    });
  });

  describe('cross-platform argument handling', () => {
    it('should handle commands without $@ placeholder', async () => {
      moxxy.exec.mock(() => ({
        stdout: {
          on: (event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'end') setTimeout(() => handler(), 20);
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
      }));

      await processModule.execWithResult('simple-command', {
        args: ['arg1', 'arg2'],
        throwOnError: false,
      });

      // Should work without errors (command constructed as "simple-command arg1 arg2")
    });

    it('should handle arguments with spaces and quotes', async () => {
      let capturedCommand = '';

      moxxy.exec.mock((command: string) => {
        capturedCommand = command;
        return {
          stdout: {
            on: (event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'end') setTimeout(() => handler(), 20);
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

      await processModule.execWithResult('echo $@', {
        args: ['hello world', 'arg with "quotes"', "arg with 'single quotes'"],
        throwOnError: false,
      });

      expect(capturedCommand).toBe(
        'echo "hello world" "arg with \\"quotes\\"" "arg with \'single quotes\'"'
      );
    });

    it('should handle empty args array', async () => {
      let capturedCommand = '';

      moxxy.exec.mock((command: string) => {
        capturedCommand = command;
        return {
          stdout: {
            on: (event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'end') setTimeout(() => handler(), 20);
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

      await processModule.execWithResult('echo $@', {
        args: [],
        throwOnError: false,
      });

      expect(capturedCommand).toBe('echo ');
    });
  });

  describe('stream output modes', () => {
    it('should pipe stdout and stderr when streamOutput is enabled', async () => {
      let stdoutPipeCalled = false;
      let stderrPipeCalled = false;

      moxxy.exec.mock(() => ({
        stdout: {
          on: (event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'end') setTimeout(() => handler(), 20);
          },

          pipe: () => {
            // Can't easily test piping to process.stdout, so just mark it as called
            stdoutPipeCalled = true;
          },
        },
        stderr: {
          on: (event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'end') setTimeout(() => handler(), 20);
          },
          pipe: () => {
            stderrPipeCalled = true;
          },
        },
        on: (event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'close') setTimeout(() => handler(0), 30);
        },
        stdin: { write: () => {}, end: () => {} },
        kill: () => {},
      }));

      await processModule.execWithResult('echo test', {
        streamOutput: true,
        preserveColors: false,
        throwOnError: false,
      });

      expect(stdoutPipeCalled).toBe(true);
      expect(stderrPipeCalled).toBe(true);
    });
  });

  describe('_exec backward compatibility', () => {
    it('should return stdout on success', async () => {
      moxxy.exec.mock(() => ({
        stdout: {
          on: (event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'data') setTimeout(() => handler('success output'), 10);
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
      }));

      const result = await processModule.exec('echo test');
      expect(result).toBe('success output');
    });

    it('should throw error on failure when throwOnError is true', async () => {
      moxxy.exec.mock(() => ({
        stdout: {
          on: (event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'end') setTimeout(() => handler(), 20);
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
          if (event === 'close') setTimeout(() => handler(1), 30);
        },
        stdin: { write: () => {}, end: () => {} },
        kill: () => {},
      }));

      try {
        await processModule.exec('failing-command', { throwOnError: true });
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.type).toBe('Unknown');
        expect(error.id).toBe('process-error-code');
      }
    });

    it('should return stdout even on failure when throwOnError is false', async () => {
      moxxy.exec.mock(() => ({
        stdout: {
          on: (event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'data') setTimeout(() => handler('output before failure'), 10);
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
          if (event === 'close') setTimeout(() => handler(1), 30);
        },
        stdin: { write: () => {}, end: () => {} },
        kill: () => {},
      }));

      const result = await processModule.exec('failing-command', { throwOnError: false });
      expect(result).toBe('output before failure');
    });
  });
});
