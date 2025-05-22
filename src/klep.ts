import fs, { PathLike } from 'node:fs';
import jsonschema from 'jsonschema';
import json5 from 'json5';
import  * as _ from 'es-toolkit';
import { KlepError } from './errors.ts';
import { klepDepsSchema } from './schemas/klep.deps.schema.ts';
import { klepKeepfileSchema } from './schemas/klep.keep.schema.ts';
import path from 'node:path';
import { getVersionType, getLatestCommit } from './git.ts';
export const DEFAULT_SUBFOLDER = 'dependencies';

let __deps: DepsFile = {}

type BaseDependency = {
  url: PathLike;
  folder?: string;
  extract?: Record<string, string> | 'all';
};

export type ResolvedDependency = BaseDependency & {
  requested: string[];
  resolved: string;
  dependencies: DependencyGraph;
}

export type Dependency = BaseDependency & {
  version?: string;
}

export type DepsFile = {
  dependencyFolder?: string;
  dependencies?: Record<string, Dependency>;
  devDependencies?: Record<string, Dependency>;
}

export type DependencyGraph = {
  [name: string]: ResolvedDependency
}

export function loadGraph(): DependencyGraph {
  const lockfile = JSON.parse(fs.readFileSync('./klep.keep', 'utf8'));
  jsonschema.validate(lockfile, klepKeepfileSchema);


  return lockfile;
}

export function loadDeps(): DepsFile | undefined {
  let deps: DepsFile = {}
  try {
    deps = json5.parse<DepsFile>(fs.readFileSync('./klep.deps', 'utf8'));
    jsonschema.validate(deps, klepDepsSchema, {throwError: true});
  } catch (e) {
    if (e instanceof jsonschema.ValidationError) {
      console.error('Invalid klep dependencies file:\n', e.message)
    } else if (e instanceof SyntaxError) {
      console.error('Error parsing klep dependencies file:\n', e.message)
    } else {
      console.error('Unknown error loading klep dependencies file:\n', e.message)
    }

    return
  }

  __deps = deps;
  return __deps;
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

  depslist![name] = dep;
}

export function isUnique(name: string, dep: Dependency): boolean {
  if (__dependencyNameExists(__deps.dependencies || {}, name)) {
    console.error(`Dependency "${name}" already exists in your core dependencies`)
    return false
  }

  if (__dependencyNameExists(__deps.devDependencies || {}, name)) {
    console.error(`Dependency "${name}" already exists in your development dependencies`)
    return false
  }

  const coreRule = __findMatchingRule(__deps.dependencies || {}, dep)
  if (coreRule) {
    console.error(`Dependency "${name}" already exists as "${coreRule}" in your core dependencies`)
    return false
  }

  const devRule = __findMatchingRule(__deps.devDependencies || {}, dep)
  if (devRule) {
    console.error(`Dependency "${name}" already exists as "${devRule}" in your development dependencies`)
    return false
  }

  return true
}

function __dependencyNameExists(deps: Record<string, Dependency>, name: string): boolean {
  return Object.keys(deps).some(listedName => listedName === name)
}

function __findMatchingRule(deps: Record<string, Dependency>, dep: Dependency): string | undefined {
  return Object.keys(deps).find(name => {
    const listedDep = deps[name]
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
  })
}

export async function createCandidateDependency(url: string, version?: string, options?: {folder?: string, extract?: string}): Promise<Dependency> {
  console.log('Finding candidate for dependency...')

  return {
    url,
    version: await __getVersion(url, version),
    folder: options?.folder || DEFAULT_SUBFOLDER,
    extract: __getExtractRules(options?.extract || '')
  }
}

function __getExtractRules(extractString: string): Dependency['extract'] {
  if (!extractString) {
    return 'all'
  }

  return extractString.split(',').reduce((extract, entry) => {
    const [from, to] = entry.split(':')
    if (!from) {
      throw new KlepError({
        type: 'parsing',
        id: 'bad-extract-option',
        message: 'The provided extract string is not in the correct format',
        context: {
          'provided-value': `"${extractString}"`,
          'expected-format': '"from[:to],from[:to],...from[:to]"',
        }
      })
    }
    extract[from] = to || from
    return extract
  }, {})
}

async function __getVersion(url: string, version?: string): Promise<string> {
  if (!version) {
    return await getLatestCommit(url)
  }

  const versionType = await getVersionType(url, version)
  switch (versionType) {
    case 'semver':
    case 'branch':
    case 'tag':
    case 'hash':
      return version
    default:
      throw new KlepError({
        type: 'parsing',
        id: 'bad-version-type',
        message: 'The provided version type is not valid',
        context: {
          'provided-value': `"${version}"`,
        }
      })
  }
}

export function ensureDependencyFolder(name: string, dep: Dependency) {
  if (!dep.folder) {
    fs.mkdirSync(path.join(process.cwd(), DEFAULT_SUBFOLDER, name), { recursive: true })
  } else {
    fs.mkdirSync(path.join(process.cwd(), dep.folder, name), { recursive: true })
  }
}
