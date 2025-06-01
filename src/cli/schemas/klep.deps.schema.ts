import { z } from 'zod';

export const extractRule = z.union([z.literal('all'), z.record(z.string(), z.string())]);

const dependency = z.object({
  url: z.string(),
  folder: z.string().optional(),
  version: z.string().optional(),
  extract: extractRule.optional(),
});

const depsFile = z.object({
  dependencyFolder: z.string().optional().default('.dependencies'),
  dependencies: z.record(z.string(), dependency),
  devDependencies: z.record(z.string(), dependency).optional(),
});

export const klepDepsSchema = depsFile;

export type ExtractRule = z.infer<typeof extractRule>;
export type Dependency = z.infer<typeof dependency>;
export type DepsFile = z.infer<typeof depsFile>;
