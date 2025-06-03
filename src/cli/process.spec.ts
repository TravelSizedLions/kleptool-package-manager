import { describe, it, expect, afterEach } from 'bun:test';
import process from './process.ts';

import { $ } from '../testing/mod.ts';
const injector = $(import.meta)!;

describe('process', () => {
  afterEach(() => {
    injector.reset();
  });

  describe('exec', () => {
    it('should execute a command', async () => {
      // Mock the child_process.exec function instead of injector.exec
      injector.exec.mock(() => {
        // Create proper mock streams with EventEmitter functionality
        const mockStream = {
          on: (event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'data') {
              // Simulate stream data
              setTimeout(() => handler('Hello, world!\n'), 10);
            } else if (event === 'end') {
              // Simulate stream end
              setTimeout(() => handler(), 20);
            }
          },
          pipe: () => {},
        };

        const mockChildProcess = {
          stdout: mockStream,
          stderr: {
            on: (event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'data') {
                // No stderr data for successful command
              } else if (event === 'end') {
                setTimeout(() => handler(), 20);
              }
            },
            pipe: () => {},
          },
          on: (event: string, handler: (...args: unknown[]) => void) => {
            if (event === 'close') {
              // Simulate successful exit
              setTimeout(() => handler(0), 30);
            } else if (event === 'error') {
              // No error for successful command
            }
          },
          stdin: {
            write: () => {},
            end: () => {},
          },
          kill: () => {},
        };

        return mockChildProcess;
      });

      const result = await process.exec('echo "Hello, world!"');
      expect(result).toBe('Hello, world!\n');
    });
  });
});
