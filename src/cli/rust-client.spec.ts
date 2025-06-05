import { describe, it, expect, beforeEach } from 'bun:test';
import rustClient from './rust-client.ts';
import kerror from './kerror.ts';

beforeEach(() => {
  moxxy.reset();
  rustClient.__reset__();
});

describe('__createDispatcher()', () => {
  describe('process output', () => {
    it('handles defined blobs', async () => {
      let capturedCommand = '';
      let capturedOptions = {};

      // Test: direct method mocking - this should ALSO work
      moxxy.process.ipc.mock((command: string, options: any) => {
        capturedCommand = command;
        capturedOptions = options;
        return Promise.resolve('{"result": "success"}');
      });
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
      moxxy.existsSync.mock(() => true);
      moxxy.globby.mock(() => Promise.resolve([{ name: 'bin-test--api', path: '/test/path' }]));

      const client = await rustClient();
      const testData = { test: 'data' };
      await client.test.api(testData);

      expect(capturedCommand).toBe('/test/path');
      expect(capturedOptions).toEqual({
        data: JSON.stringify(testData),
      });
    });

    it('handles undefined blobs', async () => {
      let capturedCommand = '';
      let capturedOptions = {};

      moxxy.process.mock({
        ipc: (command: string, options: any) => {
          capturedCommand = command;
          capturedOptions = options;
          return Promise.resolve('{"result": "success"}');
        },
      });
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
      moxxy.existsSync.mock(() => true);
      moxxy.globby.mock(() => Promise.resolve([{ name: 'bin-test--api', path: '/test/path' }]));
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      const client = await rustClient();
      await client.test.api();

      expect(capturedCommand).toBe('/test/path');
      expect(capturedOptions).toEqual({
        data: '',
      });
    });

    it('handles undefined process output', async () => {
      moxxy.process.mock({ ipc: () => Promise.resolve(undefined) });
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
      moxxy.existsSync.mock(() => true);
      moxxy.globby.mock(() => Promise.resolve([{ name: 'bin-test--api', path: '/test/path' }]));
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      const client = await rustClient();
      const result = await client.test.api();

      expect(result).toBeUndefined();
    });

    it('handles empty string process output', async () => {
      moxxy.process.mock({ ipc: () => Promise.resolve('') });
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
      moxxy.existsSync.mock(() => true);
      moxxy.globby.mock(() => Promise.resolve([{ name: 'bin-test--api', path: '/test/path' }]));
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      const client = await rustClient();
      const result = await client.test.api();

      expect(result).toBeUndefined();
    });

    it('handles whitespace process output', async () => {
      moxxy.process.mock({ ipc: () => Promise.resolve('   \n\t  ') });
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
      moxxy.existsSync.mock(() => true);
      moxxy.globby.mock(() => Promise.resolve([{ name: 'bin-test--api', path: '/test/path' }]));
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      const client = await rustClient();
      const result = await client.test.api();

      expect(result).toBeUndefined();
    });

    it('handles actual content from process output', async () => {
      const expectedData = { status: 'success', data: [1, 2, 3] };
      moxxy.process.mock({ ipc: () => Promise.resolve(JSON.stringify(expectedData)) });
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
      moxxy.existsSync.mock(() => true);
      moxxy.globby.mock(() => Promise.resolve([{ name: 'bin-test--api', path: '/test/path' }]));
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      const client = await rustClient();
      const result = await client.test.api<undefined, typeof expectedData>();

      expect(result).toEqual(expectedData);
    });
  });

  describe('output unmarshalling', () => {
    it('throws rust-client-json-parse-error when output is not valid JSON', async () => {
      moxxy.process.ipc.mock(() => Promise.resolve('invalid json'));
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
      moxxy.existsSync.mock(() => true);
      moxxy.globby.mock(() => Promise.resolve([{ name: 'bin-test--api', path: '/test/path' }]));
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      const client = await rustClient();

      try {
        await client.test.api();
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(kerror.isKlepError(error)).toBe(true);
        expect(error.id).toBe('rust-client-json-parse-error');
      }
    });

    it('returns valid JSON', async () => {
      const testObject = { complex: { nested: 'object' }, array: [1, 2, 3] };
      moxxy.process.ipc.mock(() => Promise.resolve(JSON.stringify(testObject)));
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
      moxxy.existsSync.mock(() => true);
      moxxy.globby.mock(() => Promise.resolve([{ name: 'bin-test--api', path: '/test/path' }]));
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      const client = await rustClient();
      const result = await client.test.api<undefined, typeof testObject>();

      expect(result).toEqual(testObject);
    });

    it('returns valid primitives', async () => {
      moxxy.process.ipc.mock(() => Promise.resolve('"hello world"'));
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
      moxxy.existsSync.mock(() => true);
      moxxy.globby.mock(() => Promise.resolve([{ name: 'bin-test--api', path: '/test/path' }]));
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      const client = await rustClient();
      const result = await client.test.api<undefined, string>();

      expect(result).toBe('hello world');
    });
  });
});

describe('__getBinarySearchPaths()', () => {
  describe('development binaries', () => {
    it('includes development binaries if they exist', async () => {
      moxxy.existsSync.mock((pathStr: string) => {
        return pathStr === 'src/rust/target/release';
      });
      moxxy.globby.mock((pattern: string) => {
        if (pattern === 'src/rust/target/release/**/bin-*--*') {
          return Promise.resolve([{ name: 'bin-test--api', path: '/dev/path' }]);
        }
        return Promise.resolve([]);
      });
      moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      const client = await rustClient();
      expect(client.test).toBeDefined();
    });

    it('does not include development binaries if they do not exist', async () => {
      moxxy.existsSync.mock((pathStr: string) => {
        return pathStr === 'dist/rust-binaries';
      });
      moxxy.globby.mock((pattern: string) => {
        if (pattern === 'dist/rust-binaries/bin-*--*') {
          return Promise.resolve([{ name: 'bin-test--api', path: '/bundled/path' }]);
        }
        return Promise.resolve([]);
      });
      moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      const client = await rustClient();
      expect(client.test).toBeDefined();
    });
  });

  describe('release binaries', () => {
    it('include release binaries if they exist', async () => {
      moxxy.existsSync.mock((pathStr: string) => {
        return pathStr === 'dist/rust-binaries';
      });
      moxxy.globby.mock((pattern: string) => {
        if (pattern === 'dist/rust-binaries/bin-*--*') {
          return Promise.resolve([{ name: 'bin-test--api', path: '/release/path' }]);
        }
        return Promise.resolve([]);
      });
      moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      const client = await rustClient();
      expect(client.test).toBeDefined();
    });

    it('does not include release binaries if they do not exist', async () => {
      moxxy.existsSync.mock((pathStr: string) => {
        return pathStr === 'src/rust/target/release';
      });
      moxxy.globby.mock((pattern: string) => {
        if (pattern === 'src/rust/target/release/**/bin-*--*') {
          return Promise.resolve([{ name: 'bin-test--api', path: '/dev/path' }]);
        }
        return Promise.resolve([]);
      });
      moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      const client = await rustClient();
      expect(client.test).toBeDefined();
    });
  });

  describe('standalone', () => {
    it('includes bundled binaries if they exist', async () => {
      moxxy.existsSync.mock((pathStr: string) => {
        // Return true for any path that ends with 'rust-binaries' to handle the actual path
        const result = pathStr.endsWith('rust-binaries');
        return result;
      });
      moxxy.globby.mock((pattern: string) => {
        // Return binaries for any pattern that includes 'rust-binaries'
        if (pattern.includes('rust-binaries/bin-*--*')) {
          return Promise.resolve([{ name: 'bin-test--api', path: '/standalone/path' }]);
        }
        return Promise.resolve([]);
      });
      moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      const client = await rustClient();
      expect(client.test).toBeDefined();
    });

    it('does not include bundled binaries if they do not exist', async () => {
      moxxy.existsSync.mock((pathStr: string) => {
        return pathStr === 'src/rust/target/release';
      });
      moxxy.globby.mock((pattern: string) => {
        if (pattern === 'src/rust/target/release/**/bin-*--*') {
          return Promise.resolve([{ name: 'bin-test--api', path: '/dev/path' }]);
        }
        return Promise.resolve([]);
      });
      moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      const client = await rustClient();
      expect(client.test).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('throws a rust-no-folders-found error if no directories are included', async () => {
      moxxy.existsSync.mock(() => false);
      moxxy.globby.mock(() => Promise.resolve([]));
      moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      try {
        await rustClient();
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(kerror.isKlepError(error)).toBe(true);
        expect(error.id).toBe('no-rust-folders-found');
      }
    });

    it('does not throw if one or more search pathes are added', async () => {
      moxxy.existsSync.mock(() => true);
      moxxy.globby.mock(() => Promise.resolve([{ name: 'bin-test--api', path: '/test/path' }]));
      moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      await expect(rustClient()).resolves.toBeDefined();
    });
  });
});

describe('__getRustBinaries()', () => {
  it('handles binaries when they are found', async () => {
    moxxy.existsSync.mock(() => true);
    moxxy.globby.mock(() =>
      Promise.resolve([
        { name: 'bin-module1--api1', path: '/path/to/bin1' },
        { name: 'bin-module2--api2', path: '/path/to/bin2' },
      ])
    );
    moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
    moxxy.path.mock(() => ({
      resolve: (p: string) => p,
      dirname: () => '/mock/dir',
      join: (...args: string[]) => args.join('/'),
    }));
    moxxy.globalThis = {
      process: { argv: ['/mock/dir/executable'] },
    };

    const client = await rustClient();
    expect(client.module1.api1).toBeDefined();
    expect(client.module2.api2).toBeDefined();
  });

  it('throws no-rust-binaries-found error when no binaries are found', async () => {
    moxxy.existsSync.mock(() => true);
    moxxy.globby.mock(() => Promise.resolve([]));
    moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
    moxxy.path.mock(() => ({
      resolve: (p: string) => p,
      dirname: () => '/mock/dir',
      join: (...args: string[]) => args.join('/'),
    }));
    moxxy.globalThis = {
      process: { argv: ['/mock/dir/executable'] },
    };

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
      moxxy.existsSync.mock(() => true);
      moxxy.globby.mock(() =>
        Promise.resolve([
          { name: 'bin-test--api', path: '/path/to/bin' },
          { name: 'bin-test--api.d', path: '/path/to/bin.d' },
        ])
      );
      moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));

      const client = await rustClient();
      expect(client.test.api).toBeDefined();
      expect(Object.keys(client.test)).toHaveLength(1);
    });

    it('filters out files ending in .pdb', async () => {
      moxxy.existsSync.mock(() => true);
      moxxy.globby.mock(() =>
        Promise.resolve([
          { name: 'bin-test--api', path: '/path/to/bin' },
          { name: 'bin-test--api.pdb', path: '/path/to/bin.pdb' },
        ])
      );
      moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));

      const client = await rustClient();
      expect(client.test.api).toBeDefined();
      expect(Object.keys(client.test)).toHaveLength(1);
    });

    it('does not filter files if they are not debugging files', async () => {
      moxxy.existsSync.mock(() => true);
      moxxy.globby.mock(() =>
        Promise.resolve([
          { name: 'bin-test--api1', path: '/path/to/bin1' },
          { name: 'bin-test--api2', path: '/path/to/bin2' },
          { name: 'bin-test--api3.exe', path: '/path/to/bin3.exe' },
        ])
      );
      moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      const client = await rustClient();
      expect(Object.keys(client.test)).toHaveLength(3);
    });
  });

  describe('module creation', () => {
    it('gracefully handles .exe extensions', async () => {
      moxxy.existsSync.mock(() => true);
      moxxy.globby.mock(() =>
        Promise.resolve([{ name: 'bin-test--api.exe', path: '/path/to/bin.exe' }])
      );
      moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));

      const client = await rustClient();
      expect(client.test.api).toBeDefined();
    });

    it('properly discovers the module from the binary name pattern', async () => {
      moxxy.existsSync.mock(() => true);
      moxxy.globby.mock(() =>
        Promise.resolve([{ name: 'bin-mymodule--someapi', path: '/path/to/bin' }])
      );
      moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      const client = await rustClient();
      expect(client.mymodule).toBeDefined();
    });

    it('properly discovers the apiName from the binary name pattern', async () => {
      moxxy.existsSync.mock(() => true);
      moxxy.globby.mock(() =>
        Promise.resolve([{ name: 'bin-testmodule--customapi', path: '/path/to/bin' }])
      );
      moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      const client = await rustClient();
      expect(client.testmodule.customapi).toBeDefined();
    });

    it('creates a full set of modules when handed various binaries', async () => {
      moxxy.existsSync.mock(() => true);
      moxxy.globby.mock(() =>
        Promise.resolve([
          { name: 'bin-mod1--api1', path: '/path/to/bin1' },
          { name: 'bin-mod1--api2', path: '/path/to/bin2' },
          { name: 'bin-mod2--api1', path: '/path/to/bin3' },
          { name: 'bin-mod3--special', path: '/path/to/bin4' },
        ])
      );
      moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
      moxxy.globalThis = {
        process: { argv: ['/mock/dir/executable'] },
      };

      const client = await rustClient();
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
    moxxy.path.mock(() => ({
      resolve: (p: string) => p,
      dirname: () => '/mock/dir',
      join: (...args: string[]) => args.join('/'),
    }));
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
    moxxy.path.mock(() => ({
      resolve: (p: string) => p,
      dirname: () => '/mock/dir',
      join: (...args: string[]) => args.join('/'),
    }));
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

describe('singleton', () => {
  describe('initialization', () => {
    it('constructs a backend if one does not already exist', async () => {
      moxxy.existsSync.mock(() => true);
      moxxy.globby.mock(() => Promise.resolve([{ name: 'bin-test--api', path: '/path/to/bin' }]));
      moxxy.process.mock(() => ({ ipc: () => Promise.resolve('{}') }));
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
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
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
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
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
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

    it('creates a KlepError from a generic Error if the backend is not found', async () => {
      const genericError = new Error('Some generic error');
      moxxy.existsSync.mock(() => {
        throw genericError;
      });
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
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
      moxxy.path.mock(() => ({
        resolve: (p: string) => p,
        dirname: () => '/mock/dir',
        join: (...args: string[]) => args.join('/'),
      }));
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
