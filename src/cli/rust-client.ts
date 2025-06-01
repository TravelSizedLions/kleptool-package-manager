import process, { IpcOptions } from './process.ts';
import kerror from './kerror.ts';
import { globby } from 'globby';
import path from 'path';
import { existsSync } from 'fs';

type RustClient = {
  [module: string]: {
    [api: string]: Dispatcher;
  };
} & {
  help: () => string;
};

let __backend: RustClient | null = null;

type Dispatcher = <I = undefined, O = undefined>(blob?: I, options?: IpcOptions) => Promise<O>;

function __createDispatcher(binPath: string) {
  const command = path.resolve(binPath);
  return async <I, O>(blob?: I, options: IpcOptions = {}): Promise<O> => {
    const data = blob !== undefined ? JSON.stringify(blob) : '';

    const output = await process.ipc(command, { ...options, data });

    if (!output.trim()) {
      return undefined as O;
    }

    try {
      return JSON.parse(output) as O;
    } catch (e) {
      throw kerror(kerror.Unknown, 'rust-client-json-parse-error', {
        message: `Failed to parse JSON output: ${e instanceof Error ? e.message : 'Unknown error'}`,
        context: {
          output,
          error: e instanceof Error ? e.message : 'Unknown error',
        },
      });
    }
  };
}

function __getBinarySearchPaths(): string[] {
  const paths: string[] = [];

  // Development mode: look in the usual Rust target directory
  const devPath = 'src/rust/target/release/**/bin-*--*';
  if (existsSync('src/rust/target/release')) {
    paths.push(devPath);
  }

  // Bundled mode: look in the distributed rust-binaries directory
  const bundledPath = 'dist/rust-binaries/bin-*--*';
  if (existsSync('dist/rust-binaries')) {
    paths.push(bundledPath);
  }

  // Relative to executable (for standalone distribution)
  const executableDir = path.dirname(globalThis.process.argv[0]);
  const relativeBundledPath = path.join(executableDir, 'rust-binaries', 'bin-*--*');
  if (existsSync(path.join(executableDir, 'rust-binaries'))) {
    paths.push(relativeBundledPath);
  }

  return paths;
}

async function __constructor() {
  const searchPaths = __getBinarySearchPaths();

  if (searchPaths.length === 0) {
    throw new Error(
      'No Rust binary directories found. Ensure the project is built or binaries are distributed.'
    );
  }

  let binaries: Array<{ name: string; path: string }> = [];

  // Try each search path until we find binaries
  for (const searchPath of searchPaths) {
    try {
      const foundBinaries = await globby(searchPath, { objectMode: true });
      if (foundBinaries.length > 0) {
        binaries = foundBinaries;
        console.log(`📦 Found Rust binaries in: ${path.dirname(searchPath)}`);
        break;
      }
    } catch (error) {
      // Continue to next path if this one fails
      continue;
    }
  }

  if (binaries.length === 0) {
    throw new Error(`No Rust binaries found in any search paths: ${searchPaths.join(', ')}`);
  }

  const modules = binaries
    .filter((entry) => {
      // Exclude .d files (debug symbols) and .pdb files (Windows debug info)
      return !entry.name.endsWith('.d') && !entry.name.endsWith('.pdb');
    })
    .reduce((modules: RustClient, entry) => {
      // Remove .exe extension on Windows for parsing
      const baseName = entry.name.replace(/\.exe$/, '');
      const module = baseName.split('--')[0].split('bin-')[1];
      if (!modules[module]) {
        modules[module] = {};
      }

      const apiName = baseName.split('--')[1];
      const dispatcher = __createDispatcher(entry.path.toString());
      (modules[module] as Record<string, Dispatcher>)[apiName] = dispatcher;

      return modules;
    }, {} as RustClient);

  Object.defineProperty(modules, 'help', {
    value: () => {
      const help =
        `Available APIs:\n` +
        Object.entries(modules)
          .map(([module, apis]) => {
            return Object.entries(apis)
              .map(([api, _dispatcher]) => {
                return `${module}.${api}`;
              })
              .join('\n');
          })
          .join('\n');

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
