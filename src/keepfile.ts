import fs from 'node:fs';
import path from 'node:path';
import kerror from './kerror.ts';
import json5 from 'json5';
import process from 'node:process';
import depsfile from './depsfile.ts';
import { Dependency } from './schemas/klep.deps.schema.ts';
import { klepKeepfileSchema, type DependencyGraph } from './schemas/klep.keep.schema.ts';
import _ from 'es-toolkit';

const DEFAULT: DependencyGraph = [];

let __keep: DependencyGraph = DEFAULT;

function initialize() {
  if (fs.existsSync(path.join(process.cwd(), 'klep.keep'))) {
    throw kerror(kerror.type.Parsing, 'klep-file-exists', {
      message: 'A klep.keep file already exists in the current directory',
    });
  }

  fs.writeFileSync(path.join(process.cwd(), 'klep.keep'), json5.stringify(DEFAULT, null, 2));
  return DEFAULT;
}

function ensureDependencyFolder(name: string, dep: Dependency) {
  if (!dep.folder) {
    fs.mkdirSync(path.join(process.cwd(), depsfile.defaults.dependencyFolder, name), {
      recursive: true,
    });
  } else {
    fs.mkdirSync(path.join(process.cwd(), dep.folder, name), {
      recursive: true,
    });
  }
}

function load(): DependencyGraph {
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

    __keep = result.data;
    return __keep;
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

function clone(): DependencyGraph {
  return _.cloneDeep(__keep);
}

export default {
  initialize,
  load,
  ensureDependencyFolder,
  clone,
  defaults: DEFAULT,
};
