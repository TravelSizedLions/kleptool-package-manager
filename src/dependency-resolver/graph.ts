import { BaseDependency } from '../klep.ts'
import { klepKeepfileSchema } from '../schemas/klep.keep.schema.ts'
import fs from 'node:fs'
import jsonschema from 'jsonschema'

export type ResolvedDependency = BaseDependency & {
  requested: string[]
  resolved: string
  dependencies: DependencyGraph
}

export type DependencyGraph = {
  root: ResolvedDependency
  nodes: Map<string, ResolvedDependency>
}

export function loadKeepfile(): DependencyGraph {
  const lockfile = JSON.parse(fs.readFileSync('./klep.keep', 'utf8'))
  jsonschema.validate(lockfile, klepKeepfileSchema)

  return lockfile
}
