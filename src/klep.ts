import fs from 'node:fs';
import kerror from './kerror.ts';
import depsfile from './depsfile.ts'

import path from 'node:path';
import { getVersionType, getLatestCommit } from './git.ts';
import process from 'node:process';
import keepfile from './keepfile.ts'
import { Dependency } from './schemas/klep.deps.schema.ts'

export function loadDeps() {
  return depsfile.load();
}

export function saveDeps() {
  depsfile.save();
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
    folder: options?.folder || depsfile.load().dependencyFolder,
    extract: __getExtractRules(options?.extract || ''),
  };
}

export function isUnique(name: string, dep: Dependency): boolean {
  return depsfile.exists(name, dep);
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
    fs.mkdirSync(path.join(process.cwd(), depsfile.defaults.dependencyFolder, name), {
      recursive: true,
    });
  } else {
    fs.mkdirSync(path.join(process.cwd(), dep.folder, name), {
      recursive: true,
    });
  }
}

export function init() {
  depsfile.initialize()
  keepfile.initialize()
}
