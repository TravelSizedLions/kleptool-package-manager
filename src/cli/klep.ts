import depsfile from './depsfile.ts';
import keepfile from './keepfile.ts';
import resolver from './dependency-resolution/resolver.ts';
import { Dependency } from './schemas/klep.deps.schema.ts';

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
  return await resolver.createCandidateDependency(url, version, options);
}

export function isUnique(name: string, dep: Dependency): boolean {
  return depsfile.exists(name, dep);
}

export function ensureDependencyFolder(name: string, dep: Dependency) {
  keepfile.ensureDependencyFolder(name, dep);
}

export function addDependency(name: string, dep: Dependency, dev: boolean) {
  depsfile.addDependency(name, dep, dev);
}

export function init() {
  depsfile.initialize();
  keepfile.initialize();
}
