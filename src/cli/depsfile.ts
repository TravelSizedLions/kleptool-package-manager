import fs from 'node:fs';
import path from 'node:path';
import kerror from './kerror.ts';
import json5 from 'json5';
import { DepsFile, klepDepsSchema, Dependency } from './schemas/klep.deps.schema.ts';
import * as resources from './resource-loader.ts';
import process from 'node:process';
import * as _ from 'es-toolkit';
import defaults from './defaults.ts';

let __deps: DepsFile = defaults.depsfile.entry;

export function load(): DepsFile {
  if (__deps) {
    return __deps;
  }

  __deps = resources.load<DepsFile>('./klep.deps', klepDepsSchema);
  return __deps;
}

export function save() {
  fs.writeFileSync(path.join(process.cwd(), 'klep.deps'), json5.stringify(__deps, null, 2));
}

export function addDependency(name: string, dep: Dependency, dev: boolean = false) {
  __ensureDependencyProps(dev);
  const depslist = __getDependencyList(dev);
  const cleanedDep = __cleanDependency(dep);
  depslist![name] = cleanedDep;
}

function __ensureDependencyProps(dev: boolean) {
  if (!dev && !__deps.dependencies) {
    __deps.dependencies = {};
  }

  if (dev && !__deps.devDependencies) {
    __deps.devDependencies = {};
  }
}

function __getDependencyList(dev: boolean): Record<string, Dependency> {
  return (dev ? __deps.devDependencies : __deps.dependencies)!; // We know it exists because __ensureDependencyProps was called
}

function __cleanDependency(dep: Dependency): Dependency {
  const cleanedDep = { ...dep };

  if (__shouldRemoveFolder(dep)) {
    delete cleanedDep.folder;
  }

  if (dep.extract === 'all') {
    delete cleanedDep.extract;
  }

  return cleanedDep;
}

function __shouldRemoveFolder(dep: Dependency): boolean {
  if (!dep.folder) {
    return false;
  }

  const hasMatchingFolder = dep.folder === __deps.dependencyFolder;
  const hasDefaultFolder =
    !__deps.dependencyFolder && dep.folder === defaults.depsfile.entry.dependencyFolder;

  return hasMatchingFolder || hasDefaultFolder;
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
    throw kerror(kerror.Parsing, 'klep-file-exists', {
      message: 'A klep.deps file already exists in the current directory',
    });
  }

  fs.writeFileSync(path.join(process.cwd(), 'klep.deps'), json5.stringify(defaults, null, 2));
}

function clear() {
  __deps = defaults.depsfile.entry;
}

const depsfile = {
  initialize,
  load,
  addDependency,
  exists,
  save,
  defaults: defaults.depsfile,
  clear,
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
