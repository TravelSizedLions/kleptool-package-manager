import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import * as path from 'node:path';

// Global registry of modules and their injectable dependencies
const moduleRegistry = new Map<string, ModuleInfo>();
const mockRegistry = new Map<string, Map<string, any>>();
const moduleCache = new Map<string, any>();
const importValueToProxy = new WeakMap<any, any>();
const importValueToModuleInfo = new WeakMap<any, { modulePath: string; importName: string }>();

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
  [K in keyof T]: MockFunction<T[K]>
} & { mock: (mockObj: Partial<T>) => void };

// Dynamic injector type that matches the module's imports
type DynamicInjector<TImports = any> = {
  [K in keyof TImports]: MockFunction<TImports[K]>
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

function parseImports(filePath: string): ImportInfo[] {
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true
  );

  const imports: ImportInfo[] = [];

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral).text;
      
      if (node.importClause) {
        // Default import: import foo from 'bar'
        if (node.importClause.name) {
          imports.push({
            moduleSpecifier,
            importName: 'default',
            isDefault: true,
            isNamespace: false,
            localName: node.importClause.name.text
          });
        }

        // Named imports: import { a, b } from 'bar'
        if (node.importClause.namedBindings) {
          if (ts.isNamespaceImport(node.importClause.namedBindings)) {
            // Namespace import: import * as foo from 'bar'
            imports.push({
              moduleSpecifier,
              importName: '*',
              isDefault: false,
              isNamespace: true,
              localName: node.importClause.namedBindings.name.text
            });
          } else if (ts.isNamedImports(node.importClause.namedBindings)) {
            // Named imports
            for (const element of node.importClause.namedBindings.elements) {
              imports.push({
                moduleSpecifier,
                importName: element.propertyName?.text || element.name.text,
                isDefault: false,
                isNamespace: false,
                localName: element.name.text
              });
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

function createMockableProxy(originalValue: any, modulePath: string, importName: string): any {
  // If it's a primitive value, return it as-is
  if (originalValue === null || typeof originalValue !== 'object' && typeof originalValue !== 'function') {
    return originalValue;
  }

  const proxy = new Proxy(originalValue, {
    get(target, prop) {
      const mocks = mockRegistry.get(modulePath);
      
      // Check for full module mock
      if (mocks?.has(importName)) {
        const mockValue = mocks.get(importName);
        if (typeof mockValue === 'object' && mockValue !== null) {
          return mockValue[prop];
        }
        return mockValue;
      }
      
      // Check for specific property mock
      const propKey = `${importName}.${String(prop)}`;
      if (mocks?.has(propKey)) {
        return mocks.get(propKey);
      }
      
      const value = target[prop];
      
      // If it's a function, wrap it in another proxy for method mocking
      if (typeof value === 'function') {
        return new Proxy(value, {
          apply(fnTarget, thisArg, argumentsList) {
            const methodKey = `${importName}.${String(prop)}`;
            if (mocks?.has(methodKey)) {
              const mockFn = mocks.get(methodKey);
              return mockFn.apply(thisArg, argumentsList);
            }
            return fnTarget.apply(thisArg, argumentsList);
          }
        });
      }
      
      return value;
    },
    
    apply(target, thisArg, argumentsList) {
      const mocks = mockRegistry.get(modulePath);
      
      if (mocks?.has(importName)) {
        const mockFn = mocks.get(importName);
        if (typeof mockFn === 'function') {
          return mockFn.apply(thisArg, argumentsList);
        }
      }
      
      return target.apply(thisArg, argumentsList);
    }
  });

  // Store the mapping from original to proxy for reverse lookup
  importValueToProxy.set(originalValue, proxy);
  importValueToModuleInfo.set(originalValue, { modulePath, importName });

  return proxy;
}

async function initializeModuleProxies(moduleInfo: ModuleInfo): Promise<void> {
  if (moduleInfo.isInitialized) {
    return;
  }

  console.log(`🚀 Initializing nuclear proxies for ${moduleInfo.filePath}`);
  
  for (const importInfo of moduleInfo.imports) {
    try {
      const resolvedSpecifier = resolveModuleSpecifier(importInfo.moduleSpecifier, moduleInfo.filePath);
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
      
      console.log(`✨ Created nuclear proxy for ${importInfo.localName} from ${importInfo.moduleSpecifier}`);
      
    } catch (error) {
      console.warn(`❌ Failed to create proxy for ${importInfo.localName}:`, error);
    }
  }
  
  moduleInfo.isInitialized = true;
  console.log(`💥 Nuclear initialization complete for ${moduleInfo.filePath}`);
}

async function registerModule(meta: ImportMeta): Promise<void> {
  const filePath = fileURLToPath(meta.url);
  const normalizedPath = normalizeModulePath(filePath);
  
  if (moduleRegistry.has(normalizedPath)) {
    return; // Already registered
  }

  console.log(`☢️  Registering module for nuclear injection: ${normalizedPath}`);
  
  const imports = parseImports(filePath);
  const moduleInfo: ModuleInfo = {
    filePath: normalizedPath,
    imports,
    proxies: new Map(),
    originalImports: new Map(),
    isInitialized: false
  };

  moduleRegistry.set(normalizedPath, moduleInfo);
  
  // Initialize proxies asynchronously
  await initializeModuleProxies(moduleInfo);
}

function createMockableImportProxy(originalValue: any, importName: string, modulePath: string): any {
  if (!mockRegistry.has(modulePath)) {
    mockRegistry.set(modulePath, new Map());
  }
  
  const mocks = mockRegistry.get(modulePath)!;
  
  // Create a proxy that adds .mock() method to everything
  function addMockMethod(value: any, path: string): any {
    if (value === null || value === undefined) {
      return value;
    }
    
    if (typeof value === 'function') {
      // For functions, add a mock method and proxy the function calls
      const proxiedFn = new Proxy(value, {
        apply(target, thisArg, argumentsList) {
          if (mocks.has(path)) {
            const mockFn = mocks.get(path);
            return mockFn.apply(thisArg, argumentsList);
          }
          return target.apply(thisArg, argumentsList);
        }
      });
      
      proxiedFn.mock = (mockFn: any) => {
        console.log(`🎭 Mocking function ${path}`);
        mocks.set(path, mockFn);
      };
      
      return proxiedFn;
    }
    
    if (typeof value === 'object') {
      return new Proxy(value, {
        get(target, prop) {
          if (prop === 'mock') {
            return (mockObj: any) => {
              console.log(`🎭 Mocking object ${path}`);
              mocks.set(path, mockObj);
            };
          }
          
          const propPath = `${path}.${String(prop)}`;
          
          // Check if we have a mock for this specific property
          if (mocks.has(propPath)) {
            return mocks.get(propPath);
          }
          
          // Check if we have a mock for the parent object
          if (mocks.has(path)) {
            const mockObj = mocks.get(path);
            if (mockObj && typeof mockObj === 'object') {
              return mockObj[prop];
            }
          }
          
          const originalProp = target[prop];
          return addMockMethod(originalProp, propPath);
        }
      });
    }
    
    // For primitives, just add a mock method
    const wrapper = Object.create(null);
    wrapper.valueOf = () => value;
    wrapper.toString = () => String(value);
    wrapper.mock = (mockValue: any) => {
      console.log(`🎭 Mocking primitive ${path}`);
      mocks.set(path, mockValue);
    };
    
    return wrapper;
  }
  
  return addMockMethod(originalValue, importName);
}

function createTypeSafeDependencyInjector(meta: ImportMeta): DynamicInjector {
  const filePath = fileURLToPath(meta.url);
  const targetPath = normalizeModulePath(filePath);
  
  if (!moduleRegistry.has(targetPath)) {
    throw new Error(`Module ${targetPath} not registered for injection. Make sure to call $(import.meta) in the target module first.`);
  }

  if (!mockRegistry.has(targetPath)) {
    mockRegistry.set(targetPath, new Map());
  }

  const moduleInfo = moduleRegistry.get(targetPath)!;
  const mocks = mockRegistry.get(targetPath)!;

  // Create the base injector with legacy methods
  const baseInjector = {
    mock<T>(importName: string, mockValue: T): void {
      console.log(`🎭 Mocking ${importName} in ${targetPath}`);
      mocks.set(importName, mockValue);
    },

    restore(importName?: string): void {
      if (importName) {
        console.log(`🔄 Restoring ${importName} in ${targetPath}`);
        mocks.delete(importName);
      } else {
        console.log(`🔄 Restoring all mocks in ${targetPath}`);
        mocks.clear();
      }
    },

    reset(): void {
      console.log(`💀 Resetting all mocks in ${targetPath}`);
      mocks.clear();
    }
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
        return createMockableImportProxy(originalValue, importName, targetPath);
      }
      
      return undefined;
    }
  });

  return dynamicProxy as DynamicInjector;
}

// Helper function for build-time transformed modules
export function __createModuleProxy(originalValue: any, importName: string, meta: ImportMeta): any {
  const filePath = fileURLToPath(meta.url);
  const normalizedPath = normalizeModulePath(filePath);
  
  // Register this module if not already registered
  if (!moduleRegistry.has(normalizedPath)) {
    console.log(`☢️  Auto-registering module for nuclear injection: ${normalizedPath}`);
    moduleRegistry.set(normalizedPath, {
      filePath: normalizedPath,
      imports: [], // Will be populated by transform
      proxies: new Map(),
      originalImports: new Map(),
      isInitialized: true // Already handled by transform
    });
  }

  const moduleInfo = moduleRegistry.get(normalizedPath)!;
  moduleInfo.originalImports.set(importName, originalValue);
  
  const proxy = createMockableProxy(originalValue, normalizedPath, importName);
  moduleInfo.proxies.set(importName, proxy);
  
  console.log(`✨ Build-time nuclear proxy created for ${importName} in ${normalizedPath}`);
  
  return proxy;
}

// The nuclear $ function with overloads
export function $(meta: ImportMeta): DynamicInjector | void;
export function $<T>(importValue: T): T;
export function $(metaOrImport: ImportMeta | any): any {
  // If it's import.meta, handle module registration/injection
  if (metaOrImport && typeof metaOrImport === 'object' && 'url' in metaOrImport) {
    const meta = metaOrImport as ImportMeta;
    const filePath = fileURLToPath(meta.url);
    
    // If this is a test file, return a dependency injector
    if (filePath.includes('.spec.')) {
      return createTypeSafeDependencyInjector(meta);
    }
    
    // Otherwise, register this module for injection (async but fire-and-forget)
    registerModule(meta).catch(error => {
      console.warn(`❌ Failed to register module ${filePath}:`, error);
    });
    return;
  }
  
  // If it's an import value, return the proxied version if available
  if (importValueToProxy.has(metaOrImport)) {
    const proxy = importValueToProxy.get(metaOrImport);
    console.log(`🔥 Using nuclear proxy for import value`);
    return proxy;
  }
  
  // Fallback: return the original value
  console.warn(`⚠️  No proxy found for import value, returning original`);
  return metaOrImport;
}

// Utility function to debug the nuclear system
export function __debugNuclear() {
  console.log('☢️  NUCLEAR DEBUG INFO:');
  console.log('📦 Registered modules:', Array.from(moduleRegistry.keys()));
  console.log('🎭 Mock registry:', Object.fromEntries(
    Array.from(mockRegistry.entries()).map(([key, value]) => [
      key, 
      Object.fromEntries(value.entries())
    ])
  ));
}

// Export the module registry for debugging
export const __moduleRegistry = moduleRegistry;
export const __mockRegistry = mockRegistry;

// Legacy support - keeping the old interface for backward compatibility
export default function mod(meta: ImportMeta) {
  // This is a simplified version for backward compatibility
  // Eventually we can phase this out in favor of the new $() system
  return {
    mark: () => {},
    use: (dep: any) => dep,
    mock: () => {},
    reset: () => {}
  };
}