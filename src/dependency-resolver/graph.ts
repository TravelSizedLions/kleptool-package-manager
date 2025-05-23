import fs from 'node:fs'
import json5 from 'json5'
import { KlepError } from '../errors.ts'
import {
  klepKeepfileSchema,
  type DependencyGraph,
} from '../schemas/klep.keep.schema.ts'

export function loadKeepfile(): DependencyGraph | undefined {
  try {
    const rawKeep = json5.parse(fs.readFileSync('./klep.keep', 'utf8'))
    const result = klepKeepfileSchema.safeParse(rawKeep)

    if (!result.success) {
      throw new KlepError({
        type: 'parsing',
        id: 'invalid-klep-keep-file',
        message: 'Invalid klep keep file',
        context: {
          error: result.error.message,
          issues: result.error.issues,
        },
      })
    }

    return result.data
  } catch (e: unknown) {
    if (e instanceof KlepError) {
      throw e
    } else if (e instanceof SyntaxError) {
      throw new KlepError({
        type: 'parsing',
        id: 'invalid-klep-keep-file',
        message: 'Error parsing klep keep file',
        context: {
          error: e.message,
        },
      })
    } else {
      throw new KlepError({
        type: 'parsing',
        id: 'unknown-error-loading-keep',
        message: 'Unknown error loading klep keep file',
        context: {
          error: e instanceof Error ? e.message : 'Unknown error',
        },
      })
    }
  }
}
