import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import * as path from 'node:path';
import kerror from '../cli/kerror.ts';

// Global registry of modules and their injectable dependencies
const moduleRegistry = new Map<string, ModuleInfo>();
const mockRegistry = new Map<string, Map<string, unknown>>();
const moduleCache = new Map<string, Module>();

async function __translate(error: Error) {
  const plugin = await import('./moxxy-transformer.ts');
  return plugin.translateStackTrace(error);
}

// Monkey patch console.error to automatically translate stack traces
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const translatedArgs = args.map(async (arg) => {
    if (arg instanceof Error) {
      return __translate(arg);
    }

    return arg;
  });
  Promise.all(translatedArgs).then((resolved) => {
    originalConsoleError.apply(console, resolved);
  });
};

// Monkey patch process.on for uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception:', await __translate(error));
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  if (!(reason instanceof Error)) {
    console.error('Unhandled Rejection:', reason);
    return;
  }

  console.error('Unhandled Rejection:', await __translate(reason));
});

interface ImportInfo {
  moduleSpecifier: string;
  importName: string;
  isDefault: boolean;
  isNamespace: boolean;
  localName: string;
}

interface ModuleInfo {
  filePath: string;
  imports: ImportInfo[];
  proxies: Map<string, unknown>;
  originalImports: Map<string, unknown>;
  isInitialized: boolean;
}

// Type magic for creating mockable versions of imports
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockFunction<T> = T extends (...args: any[]) => any
  ? { mock: (mockFn: T) => void } & T
  : T extends object
    ? { mock: (mockObj: Partial<T>) => void } & MockableObject<T>
    : { mock: (mockValue: T) => void } & T;

type MockableObject<T> = {
  [K in keyof T]: MockFunction<T[K]>;
} & { mock: (mockObj: Partial<T>) => void };

// Dynamic injector type that matches the module's imports
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DynamicInjector<TImports = any> = {
  [K in keyof TImports]: MockFunction<TImports[K]>;
} & {
  mock<T>(importName: string, mockValue: T): void;
  restore(importName?: string): void;
  reset(): void;
};

function __stripExtensions(filePath: string): string {
  let normalized = filePath;
  if (normalized.endsWith('.ts')) {
    normalized = normalized.slice(0, -3);
  }
  if (normalized.endsWith('.spec')) {
    normalized = normalized.slice(0, -5);
  }
  return normalized;
}

function __resolveModuleSpecifier(specifier: string, fromPath: string): string {
  if (specifier.startsWith('.')) {
    // Relative import
    const basePath = path.dirname(fromPath);
    return path.resolve(basePath, specifier);
  }
  // Absolute import (node modules, etc.)
  return specifier;
}

type Module = {
  default: unknown;
  [key: string]: unknown;
};

async function __loadModule(specifier: string): Promise<Module | undefined> {
  if (moduleCache.has(specifier)) {
    return moduleCache.get(specifier);
  }

  try {
    const module = (await import(specifier)) as Module;
    moduleCache.set(specifier, module);
    return module;
  } catch (error) {
    console.warn(`Failed to load module ${specifier}:`, error);
    return undefined;
  }
}

function __visitDeclaration(node: ts.ImportDeclaration, imports: ImportInfo[]) {
  if (!node.importClause) {
    return;
  }

  const importEntry = {
    moduleSpecifier: (node.moduleSpecifier as ts.StringLiteral).text,
    isDefault: false,
    isNamespace: false,
  };

  if (node.importClause.name) {
    imports.push({
      ...importEntry,
      importName: 'default',
      isDefault: true,
      localName: node.importClause.name.text,
    });
  }

  if (!node.importClause.namedBindings) {
    return;
  }

  if (ts.isNamespaceImport(node.importClause.namedBindings)) {
    // Namespace import: import * as foo from 'bar'
    imports.push({
      ...importEntry,
      importName: '*',
      isNamespace: true,
      localName: node.importClause.namedBindings.name.text,
    });
  } else if (ts.isNamedImports(node.importClause.namedBindings)) {
    // Named imports
    for (const element of node.importClause.namedBindings.elements) {
      imports.push({
        ...importEntry,
        importName: element.propertyName?.text || element.name.text,
        localName: element.name.text,
      });
    }
  }
}

function __visit(node: ts.Node, imports: ImportInfo[]) {
  if (ts.isImportDeclaration(node)) {
    __visitDeclaration(node, imports);
  }

  ts.forEachChild(node, (node) => __visit(node, imports));
}

function __parse(filePath: string): ImportInfo[] {
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);

  const imports: ImportInfo[] = [];
  __visit(sourceFile, imports);
  return imports;
}

function __createMoxxyProxy(originalValue: unknown, modulePath: string, importName: string) {
  // Safety check: if the value is null, undefined, or not an object/function, don't create a proxy
  if (originalValue === null || originalValue === undefined) {
    return originalValue;
  }

  if (typeof originalValue !== 'object' && typeof originalValue !== 'function') {
    console.warn(
      `⚠️  Cannot create proxy for ${importName}: value is primitive (${typeof originalValue})`
    );
    return originalValue;
  }

  if (typeof originalValue === 'function') {
    return new Proxy(originalValue, {
      apply(target, thisArg, argumentsList) {
        const mocks = mockRegistry.get(modulePath);

        if (!mocks || !mocks.has(importName)) {
          return target.apply(thisArg, argumentsList);
        }

        const mockFn = mocks.get(importName);
        const caller = typeof mockFn === 'function' ? mockFn : target;
        return caller.apply(thisArg, argumentsList);
      },
    });
  }

  if (typeof originalValue === 'object') {
    return new Proxy(originalValue, {
      get(target, prop) {
        if (target === null || target === undefined) {
          return target;
        }

        const mocks = mockRegistry.get(modulePath);

        const specificKey = `${importName}.${String(prop)}`;
        if (mocks?.has(specificKey)) {
          return mocks.get(specificKey);
        }

        // Check for full module mock
        if (mocks?.has(importName) && typeof mocks.get(importName) === 'object') {
          const fullModuleMock = mocks.get(importName);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (fullModuleMock && prop in (fullModuleMock as any)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (fullModuleMock as any)[prop];
          }
        }

        const value = (target as Record<string, unknown>)[prop as keyof Record<string, unknown>];
        if (typeof value !== 'function') {
          return value;
        }

        return new Proxy(value, {
          apply(fnTarget, thisArg, argumentsList) {
            const mocks = mockRegistry.get(modulePath);
            const methodKey = `${importName}.${String(prop)}`;
            if (!mocks || !mocks.has(methodKey)) {
              return fnTarget.apply(thisArg, argumentsList);
            }

            const mockFn = mocks.get(methodKey);
            const caller = typeof mockFn === 'function' ? mockFn : fnTarget;
            return caller.apply(thisArg, argumentsList);
          },
        });
      },
    });
  }
}

async function __resolve(importInfo: ImportInfo, moduleInfo: ModuleInfo): Promise<unknown> {
  try {
    const resolvedSpecifier = __resolveModuleSpecifier(
      importInfo.moduleSpecifier,
      moduleInfo.filePath
    );
    const module = await __loadModule(resolvedSpecifier);

    let importedValue;

    if (importInfo.isDefault) {
      importedValue = module?.default;
    } else if (importInfo.isNamespace) {
      importedValue = module;
    } else {
      importedValue = module?.[importInfo.importName];
    }

    // Store the original
    moduleInfo.originalImports.set(importInfo.localName, importedValue);

    // Create a mockable proxy
    const proxy = __createMoxxyProxy(importedValue, moduleInfo.filePath, importInfo.localName);
    moduleInfo.proxies.set(importInfo.localName, proxy);

    return proxy;
  } catch (error) {
    console.warn(`❌ Failed to create proxy for ${importInfo.localName}:`, error);
  }
}

async function __resolveModuleImports(moduleInfo: ModuleInfo): Promise<void> {
  if (moduleInfo.isInitialized) {
    return;
  }

  await Promise.all(
    moduleInfo.imports.map(async (importInfo) => __resolve(importInfo, moduleInfo))
  );

  moduleInfo.isInitialized = true;
}

async function __moxxify(meta: ImportMeta): Promise<void> {
  const filePath = fileURLToPath(meta.url);
  const normalizedPath = __stripExtensions(filePath);

  if (moduleRegistry.has(normalizedPath)) {
    return; // Already registered
  }

  const imports = __parse(filePath);
  const moduleInfo: ModuleInfo = {
    filePath: normalizedPath,
    imports,
    proxies: new Map(),
    originalImports: new Map(),
    isInitialized: false,
  };

  moduleRegistry.set(normalizedPath, moduleInfo);

  // Initialize proxies asynchronously
  await __resolveModuleImports(moduleInfo);
}

function __addMockFunction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  originalValue: any,
  importName: string,
  mocks: Map<string, Function>
): unknown {
  const proxiedFn = new Proxy(originalValue, {
    apply(target, thisArg, argumentsList) {
      if (mocks.has(importName)) {
        const mockFn = mocks.get(importName);
        return mockFn?.apply(thisArg, argumentsList);
      }
      return target.apply(thisArg, argumentsList);
    },
  });

  proxiedFn.mock = (mockFn: Function) => {
    mocks.set(importName, mockFn);
  };

  return proxiedFn;
}

function __addMockObject(
  originalValue: Record<string, unknown>,
  importName: string,
  mocks: Map<string, unknown>
): unknown {
  return new Proxy(originalValue, {
    get(target, prop) {
      if (prop === 'mock') {
        return (mockObj: unknown) => {
          mocks.set(importName, mockObj);
        };
      }

      const propPath = `${importName}.${String(prop)}`;

      // Check if we have a mock for this specific property
      if (mocks.has(propPath)) {
        return mocks.get(propPath);
      }

      // Check if we have a mock for the parent object
      if (mocks.has(importName)) {
        const mockObj = mocks.get(importName);
        if (mockObj && typeof mockObj === 'object') {
          return mockObj[prop as keyof typeof mockObj];
        }
      }

      return __addMock(target[prop as keyof typeof target], propPath, mocks);
    },
  });
}

function __addMockPrimitive(
  originalValue: unknown,
  importName: string,
  mocks: Map<string, unknown>
): unknown {
  const wrapper = Object.create(null);
  wrapper.valueOf = () => originalValue;
  wrapper.toString = () => String(originalValue);
  wrapper.mock = (mockValue: unknown) => {
    mocks.set(importName, mockValue);
  };

  return wrapper;
}

function __addMock(
  originalValue: unknown,
  importName: string,
  mocks: Map<string, unknown>
): unknown {
  if (originalValue === null || originalValue === undefined) {
    return originalValue;
  }

  switch (typeof originalValue) {
    case 'function':
      return __addMockFunction(originalValue, importName, mocks);
    case 'object':
      return __addMockObject(originalValue, importName, mocks);
    default:
      return __addMockPrimitive(originalValue, importName, mocks);
  }
}

function __mockImport(originalValue: unknown, importName: string, modulePath: string): unknown {
  if (!mockRegistry.has(modulePath)) {
    mockRegistry.set(modulePath, new Map());
  }

  return __addMock(originalValue, importName, mockRegistry.get(modulePath)!);
}

function createInjector(meta: ImportMeta): DynamicInjector {
  const filePath = __stripExtensions(meta.path);
  if (!moduleRegistry.has(filePath.replace('.spec.', '.'))) {
    throw kerror(kerror.Parsing, 'nuke-module-not-registered', {
      message: `Module ${filePath} not registered for injection. Make sure to call $(import.meta) in the target module first.`,
    });
  }

  if (!mockRegistry.has(filePath)) {
    mockRegistry.set(filePath, new Map());
  }

  const moduleInfo = moduleRegistry.get(filePath)!;
  const mocks = mockRegistry.get(filePath)!;

  // Create the base injector with legacy methods
  const baseInjector = {
    mock<T>(importName: string, mockValue: T): void {
      mocks.set(importName, mockValue);
    },

    restore(importName?: string): void {
      if (importName) {
        mocks.delete(importName);
      } else {
        mocks.clear();
      }
    },

    reset(): void {
      mocks.clear();
    },
  };

  // Dynamically add properties for each import with type-safe mocking
  const dynamicProxy = new Proxy(baseInjector, {
    get(target, prop) {
      // Return base methods
      if (prop in target) {
        return (target as Record<string, unknown>)[prop as keyof typeof target];
      }

      // Check if this is an import
      const importName = String(prop);
      if (moduleInfo.originalImports.has(importName)) {
        const originalValue = moduleInfo.originalImports.get(importName);
        return __mockImport(originalValue, importName, filePath);
      }

      return undefined;
    },
  });

  return dynamicProxy as DynamicInjector;
}

// Helper function for build-time transformed modules
export function __moxxy__(originalValue: unknown, importName: string, meta: ImportMeta): unknown {
  const filePath = fileURLToPath(meta.url);
  const normalizedPath = __stripExtensions(filePath);

  // Safety check: if the value is null, undefined, or not an object/function, return as-is
  if (originalValue === null || originalValue === undefined) {
    console.warn(`⚠️  Cannot create build-time proxy for ${importName}: value is null/undefined`);
    return originalValue;
  }

  if (typeof originalValue !== 'object' && typeof originalValue !== 'function') {
    console.warn(
      `⚠️  Cannot create build-time proxy for ${importName}: value is primitive (${typeof originalValue})`
    );
    return originalValue;
  }

  // Register this module if not already registered
  if (!moduleRegistry.has(normalizedPath)) {
    moduleRegistry.set(normalizedPath, {
      filePath: normalizedPath,
      imports: [], // Will be populated by transform
      proxies: new Map(),
      originalImports: new Map(),
      isInitialized: true, // Already handled by transform
    });
  }

  const moduleInfo = moduleRegistry.get(normalizedPath)!;
  moduleInfo.originalImports.set(importName, originalValue);

  const proxy = __createMoxxyProxy(originalValue, normalizedPath, importName);
  moduleInfo.proxies.set(importName, proxy);

  return proxy;
}

export function $(meta: ImportMeta): DynamicInjector | void {
  const filePath = meta.path;

  // If this is a test file, return a dependency injector
  if (filePath.includes('.spec.')) {
    return createInjector(meta);
  }

  // Otherwise, register this module for injection (async but fire-and-forget)
  __moxxify(meta).catch((error) => {
    console.warn(`❌ Failed to register module ${filePath}:`, error);
  });
}
