import fs, { PathLike } from 'node:fs';
import json5 from 'json5';
import * as _ from 'es-toolkit';
import kerror from './kerror.ts';
import { klepDepsSchema, DepsFile } from './schemas/klep.deps.schema.ts';

import path from 'node:path';
import { getVersionType, getLatestCommit } from './git.ts';
import process from 'node:process';

export const DEFAULT_SUBFOLDER = '.dependencies';

const DEFAULT_KLEP_FILE: DepsFile = {
  dependencyFolder: DEFAULT_SUBFOLDER,
  dependencies: {},
  devDependencies: {},
};

let __deps: DepsFile = DEFAULT_KLEP_FILE;

export type BaseDependency = {
  url: PathLike;
  folder?: string;
  extract?: Record<string, string> | 'all';
};

export type Dependency = BaseDependency & {
  version?: string;
};

export function loadDeps(): DepsFile {
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

export function saveDeps() {
  fs.writeFileSync('./klep.deps', json5.stringify(__deps, null, 2));
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
    (!__deps.dependencyFolder && dep.folder === DEFAULT_SUBFOLDER)
  ) {
    delete dep.folder;
  }

  if (dep.extract === 'all') {
    delete dep.extract;
  }

  depslist![name] = dep;
}

export function isUnique(name: string, dep: Dependency): boolean {
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

export async function createCandidateDependency(
  url: string,
  version?: string,
  options?: { folder?: string; extract?: string }
): Promise<Dependency> {
  console.log('Finding candidate for dependency...');

  return {
    url,
    version: await __getVersion(url, version),
    folder: options?.folder || DEFAULT_SUBFOLDER,
    extract: __getExtractRules(options?.extract || ''),
  };
}

function __getExtractRules(extractString: string): Dependency['extract'] {
  if (!extractString) {
    return 'all';
  }

  return extractString.split(',').reduce((extract: Record<string, string>, entry) => {
    const [from, to] = entry.split(':');
    if (!from) {
      throw kerror(kerror.type.Parsing, 'bad-extract-option', {
        message: 'The provided extract string is not in the correct format',
        context: {
          'provided-value': `"${extractString}"`,
          'expected-format': '"from[:to],from[:to],...from[:to]"',
        },
      });
    }
    extract[from] = to || from;
    return extract;
  }, {});
}

async function __getVersion(url: string, version?: string): Promise<string> {
  if (!version || version === 'latest') {
    return await getLatestCommit(url);
  }

  const versionType = await getVersionType(url, version);
  switch (versionType) {
    case 'semver':
    case 'branch':
    case 'tag':
    case 'hash':
      return version;
    default:
      throw kerror(kerror.type.Parsing, 'bad-version-type', {
        message: 'The provided version type is not valid',
        context: {
          'provided-value': `"${version}"`,
        },
      });
  }
}

export function ensureDependencyFolder(name: string, dep: Dependency) {
  if (!dep.folder) {
    fs.mkdirSync(path.join(process.cwd(), DEFAULT_SUBFOLDER, name), {
      recursive: true,
    });
  } else {
    fs.mkdirSync(path.join(process.cwd(), dep.folder, name), {
      recursive: true,
    });
  }
}

export function init() {
  if (fs.existsSync(path.join(process.cwd(), 'klep.deps'))) {
    throw kerror(kerror.type.Parsing, 'klep-file-exists', {
      message: 'A klep.deps file already exists in the current directory',
    });
  }

  fs.mkdirSync(path.join(process.cwd(), DEFAULT_SUBFOLDER), { recursive: true });
  fs.writeFileSync(
    path.join(process.cwd(), 'klep.deps'),
    json5.stringify(DEFAULT_KLEP_FILE, null, 2)
  );
  fs.writeFileSync(path.join(process.cwd(), 'klep.keep'), json5.stringify({}, null, 2));
}
