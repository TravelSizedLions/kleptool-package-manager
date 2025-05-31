import kerror from './kerror.ts';
import sh from './sh.ts';
import { GlobEntry, globby } from 'globby';

type RustClient = {
  std: Record<string, Dispatcher>;
  imported: Record<string, Dispatcher>;
}

let __backend: RustClient | null = null;

type Dispatcher = <I, O>(blob: I) => Promise<O>;

function __createDispatcher(path: string) {
  return async <I, O>(blob: I): Promise<O> => {
    // TODO add type checking/input + output validation
    return await sh(path, { args: [JSON.stringify(blob)] }) as O;
  }
}

function __mapToDispatchers(entries: GlobEntry[]): Record<string, Dispatcher> {
  return entries.reduce((dispatchers, entry) => {
    dispatchers[entry.name] = __createDispatcher(entry.path.toString());
    return dispatchers;
  }, {} as Record<string, Dispatcher>)
}

async function __constructor() {
  // TODO: add actual paths
  return await (async () => ({
    std: __mapToDispatchers(await globby('path/to/std/**/*', {objectMode: true})),
    imported: __mapToDispatchers(await globby('path/to/imported/**/*', {objectMode: true})),
  }))();
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