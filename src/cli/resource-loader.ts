import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import kerror from './kerror.ts';
import json5 from 'json5';

function __resolve(resourcePath: string) {
  return path.join(process.cwd(), resourcePath);
}

function __load(resourcePath: string) {
  try {
    return readFileSync(__resolve(resourcePath), 'utf8');
  } catch (e) {
    throw kerror(kerror.Parsing, 'invalid-klep-resource', {
      message: 'Invalid klep resource',
      context: {
        stack: e instanceof Error ? e.stack : undefined,
        error: e instanceof Error ? e.message : 'Unknown error',
      },
    });
  }
}

export function load<T>(resourcePath: string, schema: z.ZodSchema): T {
  const content = __load(resourcePath);

  try {
    // Parse the content as JSON before validating against the schema
    const parsedContent = json5.parse(content);
    return schema.parse(parsedContent) as T;
  } catch (e) {
    if (kerror.isKlepError(e)) {
      throw e;
    }

    if (e instanceof SyntaxError) {
      throw kerror(kerror.Parsing, 'invalid-klep-resource', {
        message: 'Invalid klep resource',
        context: {
          error: e.message,
          stack: e.stack,
          'file contents': content,
        },
      });
    }

    throw kerror(kerror.Unknown, 'unknown-error-loading-resource', {
      message: 'Unknown error loading klep resource',
      context: {
        error: e instanceof Error ? e.message : 'Unknown error',
        'file contents': content,
      },
    });
  }
}
