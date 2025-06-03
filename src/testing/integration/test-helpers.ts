import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import json5 from 'json5';

type TasksFile = Record<string, string>;

/**
 * Test helper for creating temporary task files for integration tests
 */
export class MockTasksFile {
  private tempFilePath: string;
  private originalExists: boolean;

  constructor(tasks: TasksFile, tempFileName = 'test-klep.tasks') {
    this.tempFilePath = join(process.cwd(), tempFileName);
    this.originalExists = existsSync(this.tempFilePath);

    // Write the mock tasks to a temporary file
    writeFileSync(this.tempFilePath, json5.stringify(tasks, null, 2));
  }

  /**
   * Get the path to the temporary tasks file
   */
  getPath(): string {
    return this.tempFilePath;
  }

  /**
   * Clean up the temporary file
   */
  cleanup(): void {
    if (existsSync(this.tempFilePath) && !this.originalExists) {
      unlinkSync(this.tempFilePath);
    }
  }

  /**
   * Update the tasks in the temporary file
   */
  updateTasks(tasks: TasksFile): void {
    writeFileSync(this.tempFilePath, json5.stringify(tasks, null, 2));
  }
}

/**
 * Higher-order function for running tests with mocked tasks
 */
export async function withMockTasks<T>(
  tasks: TasksFile,
  testFn: (tasksFilePath: string) => T | Promise<T>
): Promise<T> {
  const mockFile = new MockTasksFile(tasks);

  try {
    const result = await testFn(mockFile.getPath());
    return result;
  } finally {
    mockFile.cleanup();
  }
}

/**
 * Create a basic set of test tasks
 */
export const testTasks: TasksFile = {
  'test:simple': 'echo "Hello, World!"',
  'test:fail': 'exit 1',
  'test:args': 'echo "Args: $@"',
  'test:multi': 'echo "First" && echo "Second"',
};
