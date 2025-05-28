import fs from 'node:fs';
import path from 'node:path';
import kerror from './kerror.ts';
import json5 from 'json5';
import { DepsFile, klepDepsSchema, Dependency } from './schemas/klep.deps.schema.ts';
import process from 'node:process';
import * as _ from 'es-toolkit';
import _defaults from './defaults.ts';

const defaults: DepsFile = _defaults.depsfile.entry;
let __deps: DepsFile = defaults;

export function load(): DepsFile {
  try {
    const rawDeps = json5.parse(fs.readFileSync('./klep.deps', 'utf8'));
    const result = klepDepsSchema.safeParse(rawDeps);

    if (!result.success) {
      throw kerror(kerror.type.Parsing, 'invalid-klep-deps-file', {
        message: 'Invalid klep dependencies file',
        context: {
          error: result.error.message,
          issues: result.error.issues,
        },
      });
    }

    __deps = result.data;
    return __deps;
  } catch (e: unknown) {
    if (kerror.isKlepError(e)) {
      throw e;
    }

    if (e instanceof SyntaxError) {
      throw kerror(kerror.type.Parsing, 'invalid-klep-deps-file', {
        message: 'Error parsing klep dependencies file',
        context: {
          error: e.message,
        },
      });
    }

    throw kerror(kerror.type.Parsing, 'unknown-error-loading-deps', {
      message: 'Unknown error loading klep dependencies file',
      context: {
        error: e instanceof Error ? e.message : 'Unknown error',
      },
    });
  }
}

export function save() {
  fs.writeFileSync(path.join(process.cwd(), 'klep.deps'), json5.stringify(__deps, null, 2));
}

export function addDependency(name: string, dep: Dependency, dev: boolean = false) {
  if (!dev && !__deps.dependencies) {
    __deps.dependencies = {};
  } else if (dev && !__deps.devDependencies) {
    __deps.devDependencies = {};
  }

  const depslist = dev ? __deps.devDependencies : __deps.dependencies;

  if (
    (dep.folder && __deps.dependencyFolder === dep.folder) ||
    (!__deps.dependencyFolder && dep.folder === defaults.dependencyFolder)
  ) {
    delete dep.folder;
  }

  if (dep.extract === 'all') {
    delete dep.extract;
  }

  depslist![name] = dep;
}

function exists(name: string, dep: Dependency): boolean {
  if (__dependencyNameExists(__deps.dependencies || {}, name)) {
    console.error(`Dependency "${name}" already exists in your core dependencies`);
    return false;
  }

  if (__dependencyNameExists(__deps.devDependencies || {}, name)) {
    console.error(`Dependency "${name}" already exists in your development dependencies`);
    return false;
  }

  const coreRule = __findMatchingRule(__deps.dependencies || {}, dep);
  if (coreRule) {
    console.error(`Dependency "${name}" already exists as "${coreRule}" in your core dependencies`);
    return false;
  }

  const devRule = __findMatchingRule(__deps.devDependencies || {}, dep);
  if (devRule) {
    console.error(
      `Dependency "${name}" already exists as "${devRule}" in your development dependencies`
    );
    return false;
  }

  return true;
}

function __dependencyNameExists(deps: Record<string, Dependency>, name: string): boolean {
  return Object.keys(deps).some((listedName) => listedName === name);
}

function __findMatchingRule(deps: Record<string, Dependency>, dep: Dependency): string | undefined {
  return Object.keys(deps).find((name) => {
    const listedDep = deps[name];
    if (listedDep.url !== dep.url) {
      return false;
    }

    if (dep.version && dep.version !== 'latest' && dep.version !== listedDep.version) {
      return false;
    }

    if (dep.folder !== listedDep.folder) {
      return false;
    }

    if (!_.isEqual(dep.extract, listedDep.extract)) {
      return false;
    }

    return true;
  });
}

function initialize() {
  if (fs.existsSync(path.join(process.cwd(), 'klep.deps'))) {
    throw kerror(kerror.type.Parsing, 'klep-file-exists', {
      message: 'A klep.deps file already exists in the current directory',
    });
  }

  fs.writeFileSync(path.join(process.cwd(), 'klep.deps'), json5.stringify(defaults, null, 2));
}

const depsfile = {
  initialize,
  load,
  addDependency,
  exists,
  save,
  defaults,
};

Object.defineProperty(depsfile, 'dependencies', {
  get: () => __deps.dependencies,
});

Object.defineProperty(depsfile, 'devDependencies', {
  get: () => __deps.devDependencies,
});

Object.defineProperty(depsfile, 'dependencyFolder', {
  get: () => __deps.dependencyFolder,
});

export default depsfile;
