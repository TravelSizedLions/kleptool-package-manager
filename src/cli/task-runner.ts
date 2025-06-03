import * as resources from './resource-loader.ts';
import { klepTasksSchema, TasksFile } from './schemas/klep.tasks.schema.ts';
import kerror from './kerror.ts';
import process from './process.ts';
import nodeProcess from 'node:process';

type TaskRunnerOptions = {
  silent?: boolean;
  tasksFilePath?: string;
};

async function __do(alias: string, args: string[], options: TaskRunnerOptions = {}) {
  const tasksFilePath = options.tasksFilePath || './klep.tasks';
  const tasks = resources.load<TasksFile>(tasksFilePath, klepTasksSchema);

  if (!tasks) {
    throw kerror(kerror.type.Argument, 'no-tasks-found', {
      message: `No tasks found`,
      context: {
        'tasks file': 'klep.tasks',
      },
    });
  }

  const task = tasks[alias];
  if (!task) {
    throw kerror(kerror.type.Argument, 'task-not-found', {
      message: `Task ${alias} not found`,
      context: {
        alias,
        tasks: Object.keys(tasks).sort(),
      },
    });
  }

  // Use streamOutput unless silent is true
  const streamOutput = !options.silent;

  // Run the command and get the full result
  const result = await process.execWithResult(task, { args, streamOutput, throwOnError: false });

  // If the command failed, exit with the same code (or 1 if code is null)
  if (!result.success) {
    const exitCode = result.exitCode || 1;
    nodeProcess.exit(exitCode);
  }

  return result.stdout;
}

export default {
  do: __do,
};
