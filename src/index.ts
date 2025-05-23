#!/usr/bin/env node

import { Command } from 'commander'
import * as klep from './klep.ts'
import packageJson from '../package.json' with { type: 'json' }
import { errorBoundary } from './errors.ts'
import process from 'node:process'
const program = new Command()

const description = `I can't believe people aren't using language-agnostic dependency management.
This feels like a good idea someone much smarter than me should have done ages ago.

I'm not sure why I'm doing this, but here we are. Hope it works.`

program.name('klep').description(description)

program.version(packageJson.version)

program
  .command('init')
  .description('Initialize a new project')
  .action(
    errorBoundary(() => {
      console.log('Initializing a new project')
      klep.init()
    })
  )

program
  .command('install')
  .description('Install dependencies')
  .action(
    errorBoundary(() => {
      console.log('Installing dependencies')
    })
  )

program
  .command('clean')
  .description('Clean the project')
  .action(
    errorBoundary(() => {
      console.log('Cleaning the project')
    })
  )

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
    `Subfolders in the dependency to extract. This string takes the form "<from1>[:<to1>],<from2>[:<to2>],...<fromN>[:<toN>]", which will extract each desired folder "from" the repository "to" the desired destination under ${klep.DEFAULT_SUBFOLDER}/<dep-name>/<to>/`
  )
  .option(
    '--to <folder>',
    `The folder to extract the dependency to. By default, the dependency is extracted to ${klep.DEFAULT_SUBFOLDER} at the root of the project`
  )
  .action(
    errorBoundary(async (...args: unknown[]) => {
      const [url, options] = args as [
        string,
        {
          version?: string
          rename?: string
          dev?: boolean
          extract?: string
          to?: string
        },
      ]
      const v = options.version || 'latest'
      const name =
        options.rename || url.split('/').pop()?.split('.').shift() || url
      console.log(`Adding dependency ${name} from ${url} with version ${v}...`)

      const candidate = await klep.createCandidateDependency(url, v, options)

      if (!klep.loadDeps()) {
        return
      }

      if (!klep.isUnique(name, candidate)) {
        return
      }

      klep.addDependency(name, candidate, options.dev)
      klep.saveDeps()
      console.log(
        `Added ${options.dev ? 'development' : 'core'} dependency ${name}@${v}`
      )
    })
  )

program.parse(process.argv)
