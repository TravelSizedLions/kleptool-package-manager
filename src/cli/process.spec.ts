import { describe, it, expect, mock, afterEach, beforeEach } from 'bun:test';
import process from './process.ts';
import kerror from './kerror.ts';

import { $ } from '../testing/mod.ts';
import Stream from 'node:stream';
const injector = $(import.meta)!;

describe('process', () => {
  afterEach(() => {
    injector.reset();
  });

  describe('exec', () => {
    it('should execute a command', async () => {
      injector.exec.mock(async () => ({
        stdin: {
          on: () => {},
          write: () => {},
          end: () => {},
        },
        stdout: {
          on: () => {},
          write: () => {},
          end: () => {},
        },
        stderr: {
          on: () => {},
          write: () => {},
          end: () => {},
        },
        code: 0,
        kill: () => {},
      }));

      const result = await process.exec('echo "Hello, world!"');
      expect(result).toBe('Hello, world!');
      expect(injector.exec).toHaveBeenCalledWith('echo "Hello, world!"');
    });
  });
});