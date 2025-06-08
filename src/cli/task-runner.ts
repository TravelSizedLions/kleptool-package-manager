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

  const streamOutput = !options.silent;
  // Enable colors by default unless in CI environment or NO_COLOR is set
  const preserveColors = streamOutput && !nodeProcess.env.CI && !nodeProcess.env.NO_COLOR;
  const result = await process.execWithResult(task, {
    args,
    streamOutput,
    preserveColors,
    throwOnError: false,
  });

  if (!result.success) {
    const exitCode = result.exitCode || 1;
    nodeProcess.exit(exitCode);
  }

  return result.stdout;
}

async function __getTasks() {
  return Object.keys(__getTaskFile());
}

function __getTaskFile() {
  const tasksFilePath = './klep.tasks';
  return resources.load<TasksFile>(tasksFilePath, klepTasksSchema);
}

export default {
  do: __do,
  getTasks: __getTasks,
  getTaskFile: __getTaskFile,
};
