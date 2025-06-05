import { describe, it, expect, mock, beforeEach } from 'bun:test';
import taskRunner from './task-runner.ts';

describe('TaskRunner', () => {
  beforeEach(() => {
    mock.module('./resource-loader.ts', () => ({
      load: mock(() => ({
        echo: 'echo Hello, world!',
      })),
    }));

    mock.module('./process.ts', () => ({
      exec: mock(() => 'Hello, world!'),
      execWithResult: mock(() => ({
        stdout: 'Hello, world!\n',
        stderr: '',
        success: true,
        exitCode: 0,
      })),
      ipc: mock(() => 'Hello, world!'),
    }));
  });

  it('should run a task', async () => {
    const result = await taskRunner.do('echo', [], { silent: true });
    // Normalize line endings for cross-platform compatibility
    const normalizedResult = result.replace(/\r\n/g, '\n');
    expect(normalizedResult).toBe('Hello, world!\n');
  });

  it('should throw an error if the task is not found', () => {
    expect(taskRunner.do('not-a-task', [])).rejects.toThrow('Task not-a-task not found');
  });

  it('throw an error if there are no tasks', () => {
    mock.module('./resource-loader.ts', () => ({
      load: mock(() => null),
    }));

    expect(taskRunner.do('echo', [])).rejects.toThrow('No tasks found');
  });
});
