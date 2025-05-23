import fs from 'node:fs';
import json5 from 'json5';
import kerror from '../kerror.ts';
import { klepKeepfileSchema, type DependencyGraph } from '../schemas/klep.keep.schema.ts';

export function loadKeepfile(): DependencyGraph {
  try {
    const rawKeep = json5.parse(fs.readFileSync('./klep.keep', 'utf8'));
    const result = klepKeepfileSchema.safeParse(rawKeep);

    if (!result.success) {
      throw kerror(kerror.type.Parsing, 'invalid-klep-keep-file', {
        message: 'Invalid klep keep file',
        context: {
          error: result.error.message,
          issues: result.error.issues,
        },
      });
    }

    return result.data;
  } catch (e: unknown) {
    if (kerror.isKlepError(e)) {
      throw e;
    } else if (e instanceof SyntaxError) {
      throw kerror(kerror.type.Parsing, 'invalid-klep-keep-file', {
        message: 'Error parsing klep keep file',
        context: {
          error: e.message,
        },
      });
    } else {
      throw kerror(kerror.type.Parsing, 'unknown-error-loading-keep', {
        message: 'Unknown error loading klep keep file',
        context: {
          error: e instanceof Error ? e.message : 'Unknown error',
        },
      });
    }
  }
}

