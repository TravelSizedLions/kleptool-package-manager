import { fileURLToPath } from 'node:url';

// ============================================================================
// MOXXY: A Working Mock Injection System
// ============================================================================

// Global state - keeps it simple
const moduleRegistry = new Map<string, ModuleData>();
const activeTestContext = { current: null as string | null };

type ModuleData = {
  exports: Map<string, any>;
  proxies: Map<string, any>;
};

type MockRegistry = Map<string, any>;

// ============================================================================
// Core Registration System
// ============================================================================

export function __moxxy__(originalValue: any, importName: string, meta: ImportMeta): any {
  const modulePath = __getModulePath(meta);
  
  // Get or create module data
  if (!moduleRegistry.has(modulePath)) {
    moduleRegistry.set(modulePath, {
      exports: new Map(),
      proxies: new Map(),
    });
  }
  
  const moduleData = moduleRegistry.get(modulePath)!;
  
  // Store the original export
  moduleData.exports.set(importName, originalValue);
  
  // Create or get the proxy for this import
  if (!moduleData.proxies.has(importName)) {
    const proxy = __createGlobalProxy(originalValue, importName);
    moduleData.proxies.set(importName, proxy);
  }
  
  // Return the proxy (this is what the module will actually use)
  return moduleData.proxies.get(importName);
}

// ============================================================================
// Proxy Creation - The Heart of Mocking
// ============================================================================

function __createGlobalProxy(originalValue: any, importName: string): any {
  if (typeof originalValue === 'function') {
    // Function proxy
    const proxyFn = function(this: any, ...args: any[]) {
      const mockValue = __getActiveMock(importName);
      if (mockValue !== undefined) {
        if (typeof mockValue === 'function') {
          return mockValue.apply(this, args);
        }
        return mockValue;
      }
      return originalValue.apply(this, args);
    };
    
    // Copy all properties from original function
    Object.setPrototypeOf(proxyFn, originalValue);
    Object.getOwnPropertyNames(originalValue).forEach(key => {
      if (key !== 'length' && key !== 'name' && key !== 'prototype') {
        try {
          (proxyFn as any)[key] = (originalValue as any)[key];
        } catch (e) {
          // Ignore read-only properties
        }
      }
    });
    
    return proxyFn;
  }
  
  if (typeof originalValue === 'object' && originalValue !== null) {
    // Object proxy
    return new Proxy(originalValue, {
      get(target, prop, receiver) {
        const propName = String(prop);
        
        // Check for nested property mock first
        const nestedMock = __getActiveNestedMock(importName, propName);
        if (nestedMock !== undefined) {
          if (typeof nestedMock === 'function') {
            return function(this: any, ...args: any[]) {
              return nestedMock.apply(this, args);
            };
          }
          return nestedMock;
        }
        
        // Check for whole object mock
        const mockValue = __getActiveMock(importName);
        if (mockValue && typeof mockValue === 'object' && prop in mockValue) {
          const mockProp = mockValue[prop];
          if (typeof mockProp === 'function') {
            return function(...args: any[]) {
              return mockProp.apply(mockValue, args);
            };
          }
          return mockProp;
        }
        
        const originalProp = Reflect.get(target, prop, receiver);
        if (typeof originalProp === 'function') {
          return function(...args: any[]) {
            return originalProp.apply(target, args);
          };
        }
        return originalProp;
      }
    });
  }
  
  // For primitive values, create a proxy that behaves like the value
  return new Proxy(function() {
    const mockValue = __getActiveMock(importName);
    return mockValue !== undefined ? mockValue : originalValue;
  }, {
    get(target, prop, receiver) {
      // Special handling for primitive conversion methods
      if (prop === 'valueOf' || prop === Symbol.toPrimitive) {
        return function() {
          const mockValue = __getActiveMock(importName);
          return mockValue !== undefined ? mockValue : originalValue;
        };
      }
      
      if (prop === 'toString') {
        return function() {
          const mockValue = __getActiveMock(importName);
          const value = mockValue !== undefined ? mockValue : originalValue;
          return String(value);
        };
      }
      
      // For any other property access, get it from the actual value
      const mockValue = __getActiveMock(importName);
      const actualValue = mockValue !== undefined ? mockValue : originalValue;
      
      if (actualValue != null && typeof actualValue === 'object') {
        return actualValue[prop];
      }
      
      return undefined;
    },
    
    // Make the proxy itself return the value when called or coerced
    apply(target, thisArg, argumentsList) {
      const mockValue = __getActiveMock(importName);
      return mockValue !== undefined ? mockValue : originalValue;
    },
    
    // Handle property setting
    set(target, prop, value) {
      return false; // Primitives are immutable
    },
    
    // Handle 'in' operator
    has(target, prop) {
      const mockValue = __getActiveMock(importName);
      const actualValue = mockValue !== undefined ? mockValue : originalValue;
      return actualValue != null && prop in Object(actualValue);
    }
  });
}

// ============================================================================
// Mock Management
// ============================================================================

const testMocks = new Map<string, MockRegistry>();

function __getActiveMock(importName: string): any {
  if (!activeTestContext.current) return undefined;
  
  const mockRegistry = testMocks.get(activeTestContext.current);
  if (!mockRegistry) return undefined;
  
  return mockRegistry.get(importName);
}

function __getActiveNestedMock(importName: string, propName: string): any {
  if (!activeTestContext.current) return undefined;
  
  const mockRegistry = testMocks.get(activeTestContext.current);
  if (!mockRegistry) return undefined;
  
  return mockRegistry.get(`${importName}.${propName}`);
}

function __setMock(importName: string, mockValue: any): void {
  if (!activeTestContext.current) {
    throw new Error('No active test context');
  }
  
  if (!testMocks.has(activeTestContext.current)) {
    testMocks.set(activeTestContext.current, new Map());
  }
  
  testMocks.get(activeTestContext.current)!.set(importName, mockValue);
}

function __clearMocks(testContext?: string): void {
  const target = testContext || activeTestContext.current;
  if (target) {
    testMocks.delete(target);
  }
}

// ============================================================================
// Test Interface
// ============================================================================

interface MockableProperty {
  mock(mockValue: any): void;
}

export type TestInjector = {
  [key: string]: MockableProperty | any;
  reset(): void;
  restore(importName?: string): void;
};

function __createMockableProperty(importName: string, moduleData: ModuleData): any {
  const mockable = {
    mock(mockValue: any) {
      __setMock(importName, mockValue);
    }
  };
  
  // Get the original value to create proxies for its properties
  const originalValue = moduleData.exports.get(importName);
  
  if (originalValue && typeof originalValue === 'object') {
    // Create mockable properties for each property of the object
    return new Proxy(mockable, {
      get(target, prop) {
        if (prop === 'mock') {
          return target.mock;
        }
        
        const propName = String(prop);
        if (propName in originalValue) {
          // Create a nested mockable property
          return {
            mock(mockValue: any) {
              // Store the mock for the nested property
              __setMock(`${importName}.${propName}`, mockValue);
            }
          };
        }
        
        return undefined;
      },
      
      has(target, prop) {
        return prop === 'mock' || String(prop) in originalValue;
      }
    });
  }
  
  return mockable;
}

function __createTestInjector(testPath: string, targetModulePath: string): TestInjector {
  // Set active test context
  activeTestContext.current = testPath;
  
  // Get the target module's exports
  const moduleData = moduleRegistry.get(targetModulePath);
  if (!moduleData) {
    const available = Array.from(moduleRegistry.keys());
    throw new Error(`Module ${targetModulePath} not found. Available: ${available.join(', ')}`);
  }
  
  const baseInjector = {
    reset() {
      __clearMocks();
    },
    
    restore(importName?: string) {
      if (importName) {
        const mockRegistry = testMocks.get(activeTestContext.current!);
        if (mockRegistry) {
          mockRegistry.delete(importName);
        }
      } else {
        __clearMocks();
      }
    }
  };
  
  // Create the dynamic injector
  return new Proxy(baseInjector, {
    get(target, prop) {
      if (prop in target) {
        return (target as any)[prop];
      }
      
      const importName = String(prop);
      if (moduleData.exports.has(importName)) {
        return __createMockableProperty(importName, moduleData);
      }
      
      return undefined;
    },
    
    has(target, prop) {
      return prop in target || moduleData.exports.has(String(prop));
    }
  });
}

// ============================================================================
// Main Entry Point
// ============================================================================

function __moxxyMain(meta: ImportMeta): TestInjector {
  const filePath = fileURLToPath(meta.url);
  
  if (!filePath.includes('.spec.')) {
    throw new Error(`Moxxy can only be used in test files (.spec.ts). Called from: ${filePath}`);
  }
  
  // Test file - create injector
  const testPath = __getTestPath(filePath);
  const targetModulePath = __getTargetModulePath(testPath);
  
  return __createTestInjector(testPath, targetModulePath);
}

// Export for plugin injection (this is what gets transformed from ~import.meta)
export { __moxxyMain as __moxxyTilde__ };

// Export as default so it can be imported with any name
export default __moxxyMain;

// ============================================================================
// Helper Functions
// ============================================================================

function __getModulePath(meta: ImportMeta): string {
  return fileURLToPath(meta.url).replace(/\.ts$/, '');
}

function __getTestPath(filePath: string): string {
  return filePath.replace(/\.ts$/, '').replace(/\.spec$/, '');
}

function __getTargetModulePath(testPath: string): string {
  return testPath.replace('.spec', '');
} 