import path from 'node:path';
import * as _ from 'es-toolkit';

type Modder = {
  reset: () => void;
} & ((file: ImportMeta) => DependencyInjector);

let __modders: Record<string, DependencyInjector> = {};
let __originals: Record<string, DependencyInjector> = {};

type DependencyInjector = {
  __dependencies: Record<string, any>;
  mark: (dep: any) => any;
  use: (dep: any) => any;
  mock: (original: any, replacement: any) => any;
  reset: () => void
}

function __modKey(filePath: string) {
  let normalized = filePath
  if (normalized.endsWith('.ts')) {
    normalized = normalized.slice(0, normalized.length- '.ts'.length)
  }

  if (normalized.endsWith('.spec')) {
    normalized = normalized.slice(0, normalized.length - '.spec'.length)
  }

  return normalized
}


function __mod(file: ImportMeta): DependencyInjector {
  const key = __modKey(file.path)
  if (!__modders[key]) {
    __modders[key] = __createModder(file);
    __originals[key] = _.cloneDeep(__modders[key])
  }

  return __modders[key];
}

function __createModder(file: ImportMeta): DependencyInjector  {
  let mod = {
    __dependencies: {},
  }

  Object.defineProperty(mod, 'mark', {
    value: (dep: unknown) => {
      // @ts-ignore
      if (mod.__dependencies[dep]) {
        // @ts-ignore
        return mod.__dependencies[dep] as any;
      }

      // @ts-ignore
      mod.__dependencies[dep] = dep as any;
      return dep;
    },
  });

  Object.defineProperty(mod, 'use', {
    // @ts-ignore
    value: (dep: any) => {
      // @ts-ignore
      return mod.__dependencies[dep];
    },
  });

  Object.defineProperty(mod, 'mock', {
    // @ts-ignore
    value: (original: any, replacement: any) => {

      console.log('mocking', original, replacement)
      // @ts-ignore
      return mod.__dependencies[original] = replacement;
    },
  });

  return mod as DependencyInjector;
}

Object.defineProperty(__mod, 'clear', {
  value: () => {
    __modders = {};
    __originals = {};
  },
});

Object.defineProperty(__mod, 'reset', {
  value: () => {
    __modders = _.cloneDeep(__originals);
  },
});

export default __mod as unknown as Modder;