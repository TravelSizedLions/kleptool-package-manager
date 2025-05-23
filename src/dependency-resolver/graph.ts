import { BaseDependency } from '../klep.ts'
import { klepKeepfileSchema } from '../schemas/klep.keep.schema.ts'
import fs from 'node:fs'
import jsonschema from 'jsonschema'

type ExtractRule = Record<string, string> | 'all'

type RequestedVersion = {
  version: string
  extract?: ExtractRule
}

type RequiredDependency = {
  name: string
  version: string
  extract?: ExtractRule
}

type ResolvedVersion = {
  version: string
  extract: ExtractRule
  requires: RequiredDependency[]
}

export type ResolvedDependency = {
  name: string
  requested: RequestedVersion[]
  resolved: ResolvedVersion
}

export type DependencyGraph = ResolvedDependency[]

export function loadKeepfile(): DependencyGraph {
  const lockfile = JSON.parse(fs.readFileSync('./klep.keep', 'utf8'))
  jsonschema.validate(lockfile, klepKeepfileSchema)

  return lockfile
}
