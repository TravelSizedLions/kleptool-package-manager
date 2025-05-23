import { z } from 'zod'
import { extractRule } from './klep.deps.schema.ts'

const requestedVersion = z.object({
  version: z.string(),
  extract: extractRule.optional(),
})

const requiredDependency = z.object({
  name: z.string(),
  version: z.string(),
  extract: extractRule.optional(),
})

const resolvedVersion = z.object({
  version: z.string(),
  extract: extractRule,
  requires: z.array(requiredDependency),
})

const resolvedDependency = z.object({
  name: z.string(),
  requested: z.array(requestedVersion),
  resolved: resolvedVersion,
})

export const klepKeepfileSchema = z.array(resolvedDependency)

export type ExtractRule = z.infer<typeof extractRule>
export type RequestedVersion = z.infer<typeof requestedVersion>
export type RequiredDependency = z.infer<typeof requiredDependency>
export type ResolvedVersion = z.infer<typeof resolvedVersion>
export type ResolvedDependency = z.infer<typeof resolvedDependency>
export type DependencyGraph = z.infer<typeof klepKeepfileSchema>

export default {
  klepKeepfileSchema,
  extractRule,
  requestedVersion,
  requiredDependency,
  resolvedVersion,
  resolvedDependency,
}
