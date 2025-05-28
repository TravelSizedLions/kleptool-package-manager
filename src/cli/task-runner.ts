import * as resources from './resource-loader.ts'
import { klepTasksSchema, TasksFile } from "./schemas/klep.tasks.schema.ts";
import kerror from "./kerror.ts";
import sh from './sh.ts';

// Define types for task runner options
type TaskRunnerOptions = {
  silent?: boolean;
};

async function __do(alias: string, args: string[], options: TaskRunnerOptions = {}) {
  const tasks = resources.load<TasksFile>("./klep.tasks", klepTasksSchema)

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
        tasks: Object.keys(tasks).sort()
      },
    });
  }

  // Use streamOutput unless silent is true
  const streamOutput = !options.silent;
  
  // Run the command with or without streaming based on silent flag
  const output = await sh(task, { args, streamOutput });
  
  return output;
}

export default {
  do: __do,
}