import { ExecOptions } from './sh.ts';
import kerror from './kerror.ts';
import sh from './sh.ts';
import { GlobEntry, globby } from 'globby';
import path from 'path';


type RustClient = {
  [module: string]: {
    [api: string]: Dispatcher;
  }
} & {
  help: () => string;
}

let __backend: RustClient | null = null;

type Dispatcher = <I = undefined, O = undefined>(blob?: I, options?: ExecOptions) => Promise<O>;

function __createDispatcher(binPath: string) {
  const resolved = path.resolve(binPath);
  return async <I, O>(blob?: I, options: ExecOptions = {}): Promise<O> => {
    // TODO add type checking/input + output validation
    return await sh(resolved, { 
      args: [blob !== undefined ? JSON.stringify(blob) : ''],
      ...options,
    }) as O;
  }
}

async function __constructor() {
  const binaries = await globby('src/rust/target/release/**/bin-*--*', {objectMode: true});

  const modules = binaries
  .filter((entry) => !entry.name.endsWith('.d'))
  .reduce((modules: RustClient, entry) => {
    const module = entry.name.split('--')[0].split('bin-')[1];
    if (!modules[module]) {
      modules[module] = {};
    }

    const apiName = entry.name.split('--')[1];
    const dispatcher = __createDispatcher(entry.path.toString());
    (modules[module] as Record<string, Dispatcher>)[apiName] = dispatcher;

    return modules;
  }, {} as RustClient);

  Object.defineProperty(modules, 'help', {
      value: () => {
        const help = `Available APIs:\n` + Object.entries(modules).map(([module, apis]) => {
          return Object.entries(apis).map(([api, _]) => {
            return `${module}.${api}`;
          }).join('\n');
        }).join('\n');

        return help;
    },
    writable: false,
    configurable: false,
  });

  return modules;
}

async function __singleton(): Promise<RustClient> {
  try {
    if (!__backend) {
      __backend = await __constructor();
    }
    return __backend;
  } catch (e) {
    throw kerror(kerror.Unknown, 'backend-not-found', {
      message: 'Klep backend not found. Likely, the rust backend is not built',
      context: {
        error: e instanceof Error ? e.message : 'Unknown error',
        stack: e instanceof Error ? e.stack : undefined,
      },
    });
  }
}

export default __singleton;