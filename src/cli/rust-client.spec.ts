import { describe, it, expect, beforeEach } from 'bun:test';
import rustClient from './rust-client.ts';
import kerror from './kerror.ts';
import { normalizeCommand } from '../testing/utils/xplat-helpers.ts';

function __createPathMock() {
  return {
    resolve: (p: string) => {
      // For test paths that start with '/', keep them as-is to avoid Windows drive letter issues
      if (p.startsWith('/')) {
        return p;
      }
      return normalizeCommand(p);
    },
    dirname: () => '/mock/dir',
    join: (...args: string[]) => args.join('/'),
  };
}

function __createProcessMock(ipcResult: string | undefined) {
  let capturedCommand = '';
  let capturedOptions = {};

  return {
    mock: {
      ipc: (command: string, options: any) => {
        capturedCommand = normalizeCommand(command);
        capturedOptions = options;
        return Promise.resolve(ipcResult);
      },
    },
    getCapturedCommand: () => capturedCommand,
    getCapturedOptions: () => capturedOptions,
  };
}

function __createMocks(
  ipcResult?: string | undefined,
  globbyResult = [{ name: 'bin-test--api', path: '/test/path' }]
) {
  // Use arguments.length to detect if first parameter was explicitly passed
  const actualIpcResult = arguments.length === 0 ? '{"result": "success"}' : ipcResult;
  const processMock = __createProcessMock(actualIpcResult);

  moxxy.process.mock(processMock.mock);
  moxxy.path.mock(__createPathMock());
  moxxy.existsSync.mock(() => true);
  moxxy.globby.mock(() => Promise.resolve(globbyResult));
  moxxy.globalThis = {
    process: { argv: ['/mock/dir/executable'] },
  };

  return processMock;
}

function __setupTest(ipcResult?: string | undefined) {
  // Pass arguments directly to preserve argument presence
  const mocks = arguments.length === 0 ? __createMocks() : __createMocks(ipcResult);
  return {
    getClient: () => rustClient(),
    getCapturedCommand: mocks.getCapturedCommand,
    getCapturedOptions: mocks.getCapturedOptions,
  };
}

function __testProcessOutput(ipcResult: string | undefined, expectedResult: any, testData?: any) {
  return async () => {
    const { getClient, getCapturedCommand, getCapturedOptions } = __setupTest(ipcResult);

    const client = await getClient();
    const result = testData ? await client.test.api(testData) : await client.test.api();

    expect(getCapturedCommand()).toBe('/test/path');
    expect(getCapturedOptions()).toEqual({
      data: testData ? JSON.stringify(testData) : '',
    });

    if (expectedResult !== undefined) {
      expect(result).toEqual(expectedResult);
    }
  };
}

function __testErrorScenario(ipcResult: string, expectedErrorId: string) {
  return async () => {
    const { getClient } = __setupTest(ipcResult);

    const client = await getClient();

    try {
      await client.test.api();
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      expect(kerror.isKlepError(error)).toBe(true);
      expect(error.id).toBe(expectedErrorId);
    }
  };
}

function __setupBinarySearchMocks(existsPaths: string[], globbyMappings: Record<string, any[]>) {
  moxxy.existsSync.mock((pathStr: string) => {
    return existsPaths.some((path) => pathStr === path || pathStr.endsWith(path));
  });

  moxxy.globby.mock((pattern: string) => {
    for (const [patternKey, result] of Object.entries(globbyMappings)) {
      if (pattern.includes(patternKey) || pattern === patternKey) {
        return Promise.resolve(result);
      }
    }
    return Promise.resolve([]);
  });

  moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
  moxxy.path.mock(__createPathMock());
  moxxy.globalThis = { process: { argv: ['/mock/dir/executable'] } };
}

function __setupModuleTest(binaries: { name: string; path: string }[]) {
  moxxy.existsSync.mock(() => true);
  moxxy.globby.mock(() => Promise.resolve(binaries));
  moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
  moxxy.path.mock(__createPathMock());
  moxxy.globalThis = { process: { argv: ['/mock/dir/executable'] } };
}

async function __testClientWithBinaries(binaries: { name: string; path: string }[]) {
  __setupModuleTest(binaries);
  return await rustClient();
}

beforeEach(() => {
  moxxy.reset();
  rustClient.__reset__();
});

// quality-ignore max-cyclomatic-complexity
describe('__createDispatcher()', () => {
  // quality-ignore max-cyclomatic-complexity
  describe('process output', () => {
    // quality-ignore max-cyclomatic-complexity
    it('handles defined blobs', async () => {
      const testData = { test: 'data' };
      await __testProcessOutput('{"result": "success"}', testData, testData);
    });

    // quality-ignore max-cyclomatic-complexity
    it('handles undefined blobs', async () => {
      const { getClient, getCapturedCommand, getCapturedOptions } =
        __setupTest('{"result": "success"}');

      const client = await getClient();
      await client.test.api();

      expect(getCapturedCommand()).toBe('/test/path');
      expect(getCapturedOptions()).toEqual({ data: '' });
    });

    // quality-ignore max-cyclomatic-complexity
    it('handles undefined process output', async () => {
      const { getClient } = __setupTest(undefined);

      const client = await getClient();
      const result = await client.test.api();

      expect(result).toBeUndefined();
    });

    it('handles empty string process output', async () => {
      const { getClient } = __setupTest('');

      const client = await getClient();
      const result = await client.test.api();

      expect(result).toBeUndefined();
    });

    it('handles whitespace process output', async () => {
      const { getClient } = __setupTest('   \n\t  ');

      const client = await getClient();
      const result = await client.test.api();

      expect(result).toBeUndefined();
    });

    it('handles actual content from process output', async () => {
      const expectedData = { status: 'success', data: [1, 2, 3] };
      await __testProcessOutput(JSON.stringify(expectedData), expectedData);
    });
  });

  describe('output unmarshalling', () => {
    it('throws rust-client-json-parse-error when output is not valid JSON', async () => {
      await __testErrorScenario('invalid json', 'rust-client-json-parse-error');
    });

    it('returns valid JSON', async () => {
      const testObject = { complex: { nested: 'object' }, array: [1, 2, 3] };
      await __testProcessOutput(JSON.stringify(testObject), testObject);
    });

    it('returns valid primitives', async () => {
      await __testProcessOutput('"hello world"', 'hello world');
    });
  });
});

// quality-ignore max-cyclomatic-complexity
describe('__getBinarySearchPaths()', () => {
  describe('development binaries', () => {
    it('includes development binaries if they exist', async () => {
      __setupBinarySearchMocks(['src/rust/target/release'], {
        'src/rust/target/release/**/bin-*--*': [{ name: 'bin-test--api', path: '/dev/path' }],
      });

      const client = await rustClient();
      expect(client.test).toBeDefined();
    });

    it('does not include development binaries if they do not exist', async () => {
      __setupBinarySearchMocks(['dist/rust-binaries'], {
        'dist/rust-binaries/bin-*--*': [{ name: 'bin-test--api', path: '/bundled/path' }],
      });

      const client = await rustClient();
      expect(client.test).toBeDefined();
    });
  });

  describe('release binaries', () => {
    it('include release binaries if they exist', async () => {
      __setupBinarySearchMocks(['dist/rust-binaries'], {
        'dist/rust-binaries/bin-*--*': [{ name: 'bin-test--api', path: '/release/path' }],
      });

      const client = await rustClient();
      expect(client.test).toBeDefined();
    });

    it('does not include release binaries if they do not exist', async () => {
      __setupBinarySearchMocks(['src/rust/target/release'], {
        'src/rust/target/release/**/bin-*--*': [{ name: 'bin-test--api', path: '/dev/path' }],
      });

      const client = await rustClient();
      expect(client.test).toBeDefined();
    });
  });

  describe('standalone', () => {
    it('includes bundled binaries if they exist', async () => {
      __setupBinarySearchMocks(['rust-binaries'], {
        'rust-binaries/bin-*--*': [{ name: 'bin-test--api', path: '/standalone/path' }],
      });

      const client = await rustClient();
      expect(client.test).toBeDefined();
    });

    it('does not include bundled binaries if they do not exist', async () => {
      __setupBinarySearchMocks(['src/rust/target/release'], {
        'src/rust/target/release/**/bin-*--*': [{ name: 'bin-test--api', path: '/dev/path' }],
      });

      const client = await rustClient();
      expect(client.test).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('throws a rust-no-folders-found error if no directories are included', async () => {
      __setupBinarySearchMocks([], {});

      try {
        await rustClient();
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(kerror.isKlepError(error)).toBe(true);
        expect(error.id).toBe('no-rust-folders-found');
      }
    });

    it('does not throw if one or more search pathes are added', async () => {
      __setupBinarySearchMocks(['src/rust/target/release'], {
        'src/rust/target/release/**/bin-*--*': [{ name: 'bin-test--api', path: '/test/path' }],
      });

      await expect(rustClient()).resolves.toBeDefined();
    });
  });
});

describe('__getRustBinaries()', () => {
  it('handles binaries when they are found', async () => {
    const client = await __testClientWithBinaries([
      { name: 'bin-module1--api1', path: '/path/to/bin1' },
      { name: 'bin-module2--api2', path: '/path/to/bin2' },
    ]);

    expect(client.module1.api1).toBeDefined();
    expect(client.module2.api2).toBeDefined();
  });

  // quality-ignore max-cyclomatic-complexity
  it('throws no-rust-binaries-found error when no binaries are found', async () => {
    __setupModuleTest([]);

    try {
      await rustClient();
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      expect(kerror.isKlepError(error)).toBe(true);
      expect(error.id).toBe('no-rust-binaries-found');
    }
  });
});

describe('__createModules()', () => {
  describe('filtering', () => {
    it('filters out files ending in .d', async () => {
      const client = await __testClientWithBinaries([
        { name: 'bin-test--api', path: '/path/to/bin' },
        { name: 'bin-test--api.d', path: '/path/to/bin.d' },
      ]);

      expect(client.test.api).toBeDefined();
      expect(Object.keys(client.test)).toHaveLength(1);
    });

    it('filters out files ending in .pdb', async () => {
      const client = await __testClientWithBinaries([
        { name: 'bin-test--api', path: '/path/to/bin' },
        { name: 'bin-test--api.pdb', path: '/path/to/bin.pdb' },
      ]);

      expect(client.test.api).toBeDefined();
      expect(Object.keys(client.test)).toHaveLength(1);
    });

    it('does not filter files if they are not debugging files', async () => {
      const client = await __testClientWithBinaries([
        { name: 'bin-test--api1', path: '/path/to/bin1' },
        { name: 'bin-test--api2', path: '/path/to/bin2' },
        { name: 'bin-test--api3.exe', path: '/path/to/bin3.exe' },
      ]);

      expect(Object.keys(client.test)).toHaveLength(3);
    });
  });

  describe('module creation', () => {
    it('gracefully handles .exe extensions', async () => {
      const client = await __testClientWithBinaries([
        { name: 'bin-test--api.exe', path: '/path/to/bin.exe' },
      ]);

      expect(client.test.api).toBeDefined();
    });

    it('properly discovers the module from the binary name pattern', async () => {
      const client = await __testClientWithBinaries([
        { name: 'bin-mymodule--someapi', path: '/path/to/bin' },
      ]);

      expect(client.mymodule).toBeDefined();
    });

    it('properly discovers the apiName from the binary name pattern', async () => {
      const client = await __testClientWithBinaries([
        { name: 'bin-testmodule--customapi', path: '/path/to/bin' },
      ]);
      expect(client.testmodule.customapi).toBeDefined();
    });

    it('creates a full set of modules when handed various binaries', async () => {
      const client = await __testClientWithBinaries([
        { name: 'bin-mod1--api1', path: '/path/to/bin1' },
        { name: 'bin-mod1--api2', path: '/path/to/bin2' },
        { name: 'bin-mod2--api1', path: '/path/to/bin3' },
        { name: 'bin-mod3--special', path: '/path/to/bin4' },
      ]);

      expect(client.mod1.api1).toBeDefined();
      expect(client.mod1.api2).toBeDefined();
      expect(client.mod2.api1).toBeDefined();
      expect(client.mod3.special).toBeDefined();
    });
  });
});

describe('__addHelp()', () => {
  it('defines a help method on the module collection', async () => {
    moxxy.existsSync.mock(() => true);
    moxxy.globby.mock(() => Promise.resolve([{ name: 'bin-test--api', path: '/path/to/bin' }]));
    moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
    moxxy.path.mock(__createPathMock());
    moxxy.globalThis = {
      process: { argv: ['/mock/dir/executable'] },
    };

    const client = await rustClient();
    expect(typeof client.help).toBe('function');
  });

  it('provides a help string listing all of the apis available for use', async () => {
    moxxy.existsSync.mock(() => true);
    moxxy.globby.mock(() =>
      Promise.resolve([
        { name: 'bin-module1--api1', path: '/path/to/bin1' },
        { name: 'bin-module1--api2', path: '/path/to/bin2' },
        { name: 'bin-module2--api1', path: '/path/to/bin3' },
      ])
    );
    moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
    moxxy.path.mock(__createPathMock());
    moxxy.globalThis = {
      process: { argv: ['/mock/dir/executable'] },
    };

    const client = await rustClient();
    const help = client.help();

    expect(help).toContain('Available APIs:');
    expect(help).toContain('module1.api1');
    expect(help).toContain('module1.api2');
    expect(help).toContain('module2.api1');
  });
});

// quality-ignore max-cyclomatic-complexity
describe('singleton', () => {
  describe('initialization', () => {
    it('constructs a backend if one does not already exist', async () => {
      moxxy.existsSync.mock(() => true);
      moxxy.globby.mock(() => Promise.resolve([{ name: 'bin-test--api', path: '/path/to/bin' }]));
      moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
      moxxy.path.mock(__createPathMock());
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      const client = await rustClient();
      expect(client).toBeDefined();
      expect(client.test.api).toBeDefined();
    });

    it('returns an existing backend if one already exists', async () => {
      moxxy.existsSync.mock(() => true);
      moxxy.globby.mock(() => Promise.resolve([{ name: 'bin-test--api', path: '/path/to/bin' }]));
      moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
      moxxy.path.mock(__createPathMock());
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      const client1 = await rustClient();
      const client2 = await rustClient();

      expect(client1).toBe(client2);
    });
  });

  describe('error handling', () => {
    it('gracefully handles rethrowing KlepErrors', async () => {
      const mockKlepError = kerror(kerror.Unknown, 'test-klep-error');
      moxxy.existsSync.mock(() => {
        throw mockKlepError;
      });
      moxxy.path.mock(__createPathMock());
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      try {
        await rustClient();
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error).toBe(mockKlepError);
      }
    });

    // quality-ignore max-cyclomatic-complexity
    it('creates a KlepError from a generic Error if the backend is not found', async () => {
      const genericError = new Error('Some generic error');
      moxxy.existsSync.mock(() => {
        throw genericError;
      });
      moxxy.path.mock(__createPathMock());
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      try {
        await rustClient();
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(kerror.isKlepError(error)).toBe(true);
        expect(error.id).toBe('backend-not-found');
        expect(error.message).toContain('Klep backend not found');
      }
    });

    it('gracefully handles creating a KlepError from a non-Error throw', async () => {
      moxxy.existsSync.mock(() => {
        throw 'string exception';
      });
      moxxy.path.mock(__createPathMock());
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      try {
        await rustClient();
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(kerror.isKlepError(error)).toBe(true);
        expect(error.id).toBe('backend-not-found');
        expect(error.message).toContain('Klep backend not found');
      }
    });
  });
});
