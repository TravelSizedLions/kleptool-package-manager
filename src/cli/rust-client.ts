import kerror from './kerror.ts';
import sh from './sh.ts';
import { GlobEntry, globby } from 'globby';

type Tree<K extends (string | number | symbol), V> = {
  [key in K]: Tree<K, V> | V;
}

type RustClient = Tree<string, Dispatcher>;

let __backend: RustClient | null = null;

type Dispatcher = <I, O>(blob: I) => Promise<O>;

function __createDispatcher(path: string) {
  return async <I, O>(blob: I): Promise<O> => {
    // TODO add type checking/input + output validation
    return await sh(path, { args: [JSON.stringify(blob)] }) as O;
  }
}

async function __constructor() {
  const binaries = await globby('src/rust/target/release/**/bin-*--*', {objectMode: true});

  return binaries.reduce((modules: RustClient, entry) => {
    const module = entry.name.split('--')[0].split('bin-')[1];
    if (!modules[module]) {
      modules[module] = {};
    }

    const apiName = entry.name.split('--')[1];
    const dispatcher = __createDispatcher(entry.path.toString());

    (modules[module] as Record<string, Dispatcher>)[apiName] = dispatcher;

    return modules;
  }, {} as RustClient);
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