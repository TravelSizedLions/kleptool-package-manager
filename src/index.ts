#!/usr/bin/env tsx

import { Command } from 'commander';
import * as klep from './cli/klep.ts';
import packageJson from '../package.json' with { type: 'json' };
import kerror from './cli/kerror.ts';
import process from 'node:process';
const program = new Command();
import defaults from './cli/defaults.ts';
import taskRunner from './cli/task-runner.ts';
import rustClient from './cli/rust-client.ts';

const DEFAULT_SUBFOLDER = defaults.depsfile.entry.dependencyFolder;

const description = `I can't believe people aren't using language-agnostic dependency management.
This feels like a good idea someone much smarter than me should have done ages ago.

I'm not sure why I'm doing this, but here we are. Hope it works.`;

program.name('klep').description(description);

program.version(packageJson.version);

// Global options
program.option('-s, --silent', 'Silence command output');
program.option('--tasks-file <path>', 'Path to tasks file (default: ./klep.tasks)');

program
  .command('init')
  .description('Initialize a new project')
  .action(
    kerror.boundary(() => {
      console.log('Initializing a new project');
      klep.init();
    })
  );

program
  .command('install')
  .description('Install dependencies')
  .action(
    kerror.boundary(() => {
      console.log('Installing dependencies');
    })
  );

program
  .command('clean')
  .description('Clean the project')
  .action(
    kerror.boundary(() => {
      console.log('Cleaning the project');
    })
  );

type AddOptions = {
  version?: string;
  rename?: string;
  dev?: boolean;
  extract?: string;
  to?: string;
};

program
  .command('add')
  .description('Add a dependency to the project')
  .argument('<url>', 'The url of the dependency to add')
  .option('-@, --version <version>', 'The version of the dependency to add')
  .option(
    '-r, --rename <rename>',
    'Rename the dependency. By default, the name is the repository name from the url.'
  )
  .option('-d, --dev', 'Add a development dependency')
  .option(
    '-e, --extract <extractString>',
    `Subfolders in the dependency to extract. This string takes the form "<from1>[:<to1>],<from2>[:<to2>],...<fromN>[:<toN>]", which will extract each desired folder "from" the repository "to" the desired destination under ${DEFAULT_SUBFOLDER}/<dep-name>/<to>/`
  )
  .option(
    '--to <folder>',
    `The folder to extract the dependency to. By default, the dependency is extracted to ${DEFAULT_SUBFOLDER} at the root of the project`
  )
  .action(
    kerror.boundary(async (url: string, options: AddOptions) => {
      const v = options.version || 'latest';
      const name = options.rename || url.split('/').pop()?.split('.').shift() || url;

      console.log(`Adding dependency ${name} from ${url} with version ${v}...`);

      const candidate = await klep.createCandidateDependency(url, v, options);

      if (!klep.loadDeps()) {
        return;
      }

      if (!klep.isUnique(name, candidate)) {
        return;
      }

      klep.addDependency(name, candidate, !!options.dev);
      klep.saveDeps();
      console.log(`Added ${options.dev ? 'development' : 'core'} dependency ${name}@${v}`);
    })
  );

program
  .command('demo')
  .description('Demo the cross-language pipeline')
  .action(
    kerror.boundary(async () => {
      const client = await rustClient();
      const res = await client.std.identity(['hello', 'world']);
      const tree = await client.ast.to_tree({
        language: 'javascript',
        source_code: 'console.log("hello")',
      });

      console.log({ res, tree });
    })
  );

program
  .argument('[task]', 'The task to run')
  .argument('[args...]', 'The arguments to pass to the task')
  .action(async (task: string, args: string[]) => {
    if (!task) {
      program.help();
      return;
    }

    try {
      const options = program.opts();
      await taskRunner.do(task, args, {
        silent: options.silent,
        tasksFilePath: options.tasksFile,
      });
    } catch (error) {
      if (kerror.isKlepError(error)) {
        console.error('❌ Task failed:', error.message);
        process.exit(1);
      }

      throw error;
    }
  });

program
  .command('tasks')
  .description('List all available tasks')
  .option('-v, --verbose', 'Verbose output')
  .option('--sort', 'Sort tasks alphabetically')
  .action(
    kerror.boundary(async (options: { verbose: boolean; sort: boolean }) => {
      let tasks = taskRunner.getTaskFile();
      if (options.sort) {
        tasks = Object.fromEntries(Object.entries(tasks).sort((a, b) => a[0].localeCompare(b[0])));
      }

      if (options.verbose) {
        console.log('Available tasks:');
        const longestName = Object.keys(tasks).reduce((max, task) => Math.max(max, task.length), 0);
        console.log(
          Object.entries(tasks)
            .map(([task, command]) => {
              const taskPart = `• ${task}`;
              const spacesNeeded = longestName - task.length + 3;
              const padding = ' ' + '·'.repeat(Math.max(1, spacesNeeded)) + ' ';
              return `${taskPart}${padding}${command}`;
            })
            .join('\n')
        );
      } else {
        console.log('Available tasks:');
        console.log(
          Object.keys(tasks)
            .map((task) => `• ${task}`)
            .join('\n')
        );
      }
    })
  );

program.parse(process.argv);
