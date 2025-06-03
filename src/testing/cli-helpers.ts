import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { withMockTasks, testTasks } from './integration/test-helpers.ts';

export type CliResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  success: boolean;
};

/**
 * Run the CLI with custom arguments
 */
export async function runCli(args: string[], tasksFilePath?: string): Promise<CliResult> {
  return new Promise((resolve) => {
    const cliPath = join(process.cwd(), 'src/index.ts');

    // Build the command arguments
    const fullArgs = tasksFilePath ? ['--tasks-file', tasksFilePath, ...args] : args;

    const child = spawn('bun', ['run', cliPath, ...fullArgs], {
      cwd: process.cwd(),
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        success: code === 0,
      });
    });

    child.on('error', (error) => {
      resolve({
        exitCode: null,
        stdout: stdout.trim(),
        stderr: error.message,
        success: false,
      });
    });
  });
}

/**
 * Run the CLI with mocked tasks
 */
export async function runCliWithMockTasks(
  args: string[],
  tasks: Record<string, string> = testTasks
): Promise<CliResult> {
  return withMockTasks(tasks, (tasksFilePath) => {
    return runCli(args, tasksFilePath);
  });
}

/**
 * Template literal function for running CLI commands with mocked tasks
 */
export function $mock(tasks: Record<string, string> = testTasks) {
  return (template: TemplateStringsArray, ...args: unknown[]): Promise<CliResult> => {
    const command = String.raw(template, ...args);
    const parsedArgs = command.split(' ').filter((arg) => arg.length > 0);

    // Remove 'klep' from the beginning if present
    if (parsedArgs[0] === 'klep') {
      parsedArgs.shift();
    }

    return runCliWithMockTasks(parsedArgs, tasks);
  };
}
