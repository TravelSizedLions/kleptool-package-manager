import fs from './file.ts';
import path from 'node:path';
import kerror from './kerror.ts';
import json5 from 'json5';
import process from 'node:process';
import depsfile from './depsfile.ts';
import { Dependency } from './schemas/klep.deps.schema.ts';
import { klepKeepfileSchema, type DependencyGraph } from './schemas/klep.keep.schema.ts';
import * as _ from 'es-toolkit';
import _defaults from './defaults.ts';
import * as resources from './resource-loader.ts';

const defaults: DependencyGraph = _defaults.keepfile;

let __keep: DependencyGraph | undefined = undefined;

function initialize() {
  if (fs.existsSync(path.join(process.cwd(), 'klep.keep'))) {
    throw kerror(kerror.Parsing, 'klep-file-exists', {
      message: 'A klep.keep file already exists in the current directory',
    });
  }

  fs.writeFileSync(path.join(process.cwd(), 'klep.keep'), json5.stringify(defaults, null, 2));
  return defaults;
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
  if (__keep) {
    return __keep;
  }

  console.log('here')
  if (!fs.existsSync(path.join(process.cwd(), 'klep.keep'))) {
    console.log('here2')
    throw kerror(kerror.Parsing, 'klep-file-not-found', {
      message: 'A klep.keep file does not exist in the current directory',
    });
  }

  console.log('here3')
  __keep = resources.load<DependencyGraph>('./klep.keep', klepKeepfileSchema);
  return __keep;
}

function clear() {
  __keep = undefined;
} 

function reload() {
  __keep = undefined;
  return load();
}

function clone(): DependencyGraph {
  load();
  return _.cloneDeep(__keep) as DependencyGraph;
}

export default {
  initialize,
  load,
  reload,
  ensureDependencyFolder,
  clone,
  defaults,
  clear,
};
