import { describe, it, expect, afterEach } from 'bun:test';
import process from './process.ts';

import { $ } from '../testing/moxxy.ts';
const moxxy = $(import.meta)!;

describe('process', () => {
  afterEach(() => {
    moxxy.reset();
  });

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
  });
});
