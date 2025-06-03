import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import * as path from 'node:path';
import kerror from '../cli/kerror.ts';

// Global registry of modules and their injectable dependencies
const moduleRegistry = new Map<string, ModuleInfo>();
const mockRegistry = new Map<string, Map<string, unknown>>();
const moduleCache = new Map<string, unknown>();

async function translateError(error: Error) {
  const plugin = await import('./transform-plugin.ts');
  return plugin.translateStackTrace(error);
}

// Monkey patch console.error to automatically translate stack traces
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const translatedArgs = args.map(async (arg) => {
    if (arg instanceof Error) {
      return translateError(arg);
    }

    return arg;
  });
  Promise.all(translatedArgs).then((resolved) => {
    originalConsoleError.apply(console, resolved);
  });
};

// Monkey patch process.on for uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception:', await translateError(error));
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  if (!(reason instanceof Error)) {
    console.error('Unhandled Rejection:', reason);
    return;
  }

  console.error('Unhandled Rejection:', await translateError(reason));
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
  proxies: Map<string, any>;
  originalImports: Map<string, any>;
  isInitialized: boolean;
}

// Type magic for creating mockable versions of imports
type MockFunction<T> = T extends (...args: any[]) => any
  ? { mock: (mockFn: T) => void } & T
  : T extends object
    ? { mock: (mockObj: Partial<T>) => void } & MockableObject<T>
    : { mock: (mockValue: T) => void } & T;

type MockableObject<T> = {
  [K in keyof T]: MockFunction<T[K]>;
} & { mock: (mockObj: Partial<T>) => void };

// Dynamic injector type that matches the module's imports
type DynamicInjector<TImports = any> = {
  [K in keyof TImports]: MockFunction<TImports[K]>;
} & {
  mock<T>(importName: string, mockValue: T): void;
  restore(importName?: string): void;
  reset(): void;
};

function normalizeModulePath(filePath: string): string {
  let normalized = filePath;
  if (normalized.endsWith('.ts')) {
    normalized = normalized.slice(0, -3);
  }
  if (normalized.endsWith('.spec')) {
    normalized = normalized.slice(0, -5);
  }
  return normalized;
}

function resolveModuleSpecifier(specifier: string, fromPath: string): string {
  if (specifier.startsWith('.')) {
    // Relative import
    const basePath = path.dirname(fromPath);
    return path.resolve(basePath, specifier);
  }
  // Absolute import (node modules, etc.)
  return specifier;
}

async function loadModule(specifier: string): Promise<any> {
  if (moduleCache.has(specifier)) {
    return moduleCache.get(specifier);
  }

  try {
    const module = await import(specifier);
    moduleCache.set(specifier, module);
    return module;
  } catch (error) {
    console.warn(`Failed to load module ${specifier}:`, error);
    return {};
  }
}

function visitImportDeclaration(node: ts.ImportDeclaration, imports: ImportInfo[]) {
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

function visit(node: ts.Node, imports: ImportInfo[]) {
  if (ts.isImportDeclaration(node)) {
    visitImportDeclaration(node, imports);
  }

  ts.forEachChild(node, (node) => visit(node, imports));
}

function parseImports(filePath: string): ImportInfo[] {
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);

  const imports: ImportInfo[] = [];
  visit(sourceFile, imports);
  return imports;
}

function createMockableProxy(originalValue: any, modulePath: string, importName: string): any {
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

  // Don't capture mocks here - do fresh lookup each time!

  return new Proxy(originalValue, {
    get(target, prop) {
      const mocks = mockRegistry.get(modulePath); // Fresh lookup each time!

      // Check for specific property mocks first (highest priority)
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

      const value = target[prop];

      // If it's a function, wrap it in another proxy for method mocking
      if (typeof value === 'function') {
        return new Proxy(value, {
          apply(fnTarget, thisArg, argumentsList) {
            const mocks = mockRegistry.get(modulePath); // Fresh lookup for each call!
            const methodKey = `${importName}.${String(prop)}`;
            if (mocks?.has(methodKey)) {
              const mockFn = mocks.get(methodKey);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return (mockFn as any).apply(thisArg, argumentsList);
            }
            return fnTarget.apply(thisArg, argumentsList);
          },
        });
      }

      return value;
    },

    apply(target, thisArg, argumentsList) {
      const mocks = mockRegistry.get(modulePath); // Fresh lookup for direct function calls!

      if (mocks?.has(importName)) {
        const mockFn = mocks.get(importName);
        if (typeof mockFn === 'function') {
          return mockFn.apply(thisArg, argumentsList);
        }
      }

      return target.apply(thisArg, argumentsList);
    },
  });
}

async function initializeModuleProxies(moduleInfo: ModuleInfo): Promise<void> {
  if (moduleInfo.isInitialized) {
    return;
  }

  for (const importInfo of moduleInfo.imports) {
    try {
      const resolvedSpecifier = resolveModuleSpecifier(
        importInfo.moduleSpecifier,
        moduleInfo.filePath
      );
      const module = await loadModule(resolvedSpecifier);

      let importedValue;

      if (importInfo.isDefault) {
        importedValue = module.default;
      } else if (importInfo.isNamespace) {
        importedValue = module;
      } else {
        importedValue = module[importInfo.importName];
      }

      // Store the original
      moduleInfo.originalImports.set(importInfo.localName, importedValue);

      // Create a mockable proxy
      const proxy = createMockableProxy(importedValue, moduleInfo.filePath, importInfo.localName);
      moduleInfo.proxies.set(importInfo.localName, proxy);
    } catch (error) {
      console.warn(`❌ Failed to create proxy for ${importInfo.localName}:`, error);
    }
  }

  moduleInfo.isInitialized = true;
}

async function registerModule(meta: ImportMeta): Promise<void> {
  const filePath = fileURLToPath(meta.url);
  const normalizedPath = normalizeModulePath(filePath);

  if (moduleRegistry.has(normalizedPath)) {
    return; // Already registered
  }

  const imports = parseImports(filePath);
  const moduleInfo: ModuleInfo = {
    filePath: normalizedPath,
    imports,
    proxies: new Map(),
    originalImports: new Map(),
    isInitialized: false,
  };

  moduleRegistry.set(normalizedPath, moduleInfo);

  // Initialize proxies asynchronously
  await initializeModuleProxies(moduleInfo);
}

function addMockFunction(originalValue: any, importName: string, mocks: Map<string, any>): any {
  const proxiedFn = new Proxy(originalValue, {
    apply(target, thisArg, argumentsList) {
      if (mocks.has(importName)) {
        const mockFn = mocks.get(importName);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (mockFn as any).apply(thisArg, argumentsList);
      }
      return target.apply(thisArg, argumentsList);
    },
  });

  proxiedFn.mock = (mockFn: any) => {
    mocks.set(importName, mockFn);
  };

  return proxiedFn;
}

function addMockObject(originalValue: any, importName: string, mocks: Map<string, any>): any {
  return new Proxy(originalValue, {
    get(target, prop) {
      if (prop === 'mock') {
        return (mockObj: any) => {
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
          return mockObj[prop];
        }
      }

      return addMock(target[prop], propPath, mocks);
    },
  });
}

function addMockPrimitive(originalValue: any, importName: string, mocks: Map<string, any>): any {
  const wrapper = Object.create(null);
  wrapper.valueOf = () => originalValue;
  wrapper.toString = () => String(originalValue);
  wrapper.mock = (mockValue: any) => {
    mocks.set(importName, mockValue);
  };

  return wrapper;
}

function addMock(originalValue: any, importName: string, mocks: Map<string, any>): any {
  if (originalValue === null || originalValue === undefined) {
    return originalValue;
  }

  switch (typeof originalValue) {
    case 'function':
      return addMockFunction(originalValue, importName, mocks);
    case 'object':
      return addMockObject(originalValue, importName, mocks);
    default:
      return addMockPrimitive(originalValue, importName, mocks);
  }
}

function createMockImport(originalValue: any, importName: string, modulePath: string): any {
  if (!mockRegistry.has(modulePath)) {
    mockRegistry.set(modulePath, new Map());
  }

  return addMock(originalValue, importName, mockRegistry.get(modulePath)!);
}

function createInjector(meta: ImportMeta): DynamicInjector {
  const filePath = normalizeModulePath(meta.path);
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
        return (target as any)[prop];
      }

      // Check if this is an import
      const importName = String(prop);
      if (moduleInfo.originalImports.has(importName)) {
        const originalValue = moduleInfo.originalImports.get(importName);
        return createMockImport(originalValue, importName, filePath);
      }

      return undefined;
    },
  });

  return dynamicProxy as DynamicInjector;
}

// Helper function for build-time transformed modules
export function __createModuleProxy(originalValue: any, importName: string, meta: ImportMeta): any {
  const filePath = fileURLToPath(meta.url);
  const normalizedPath = normalizeModulePath(filePath);

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

  const proxy = createMockableProxy(originalValue, normalizedPath, importName);
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
  registerModule(meta).catch((error) => {
    console.warn(`❌ Failed to register module ${filePath}:`, error);
  });
}

// Export the injector class for the plugin
export class DynamicNuclearInjector {
  private moduleRegistry = new Map<string, Set<string>>();

  registerModule(moduleName: string, filePath: string) {
    if (!this.moduleRegistry.has(moduleName)) {
      this.moduleRegistry.set(moduleName, new Set());
    }
    this.moduleRegistry.get(moduleName)!.add(filePath);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getProxy(_moduleName: string, _importerPath: string) {
    return null;
  }
}
