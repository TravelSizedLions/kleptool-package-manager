import { fileURLToPath } from 'node:url';

// ============================================================================
// MOXXY: A Working Mock Injection System
// ============================================================================

// ============================================================================
// Constants
// ============================================================================

const SPEC_DOT = '.spec.';
const TS_EXTENSION = '.ts';
const SPEC_EXTENSION = '.spec';

const FUNCTION_PROPS_TO_SKIP = ['length', 'name', 'prototype'];
const PRIMITIVE_METHODS = {
  VALUE_OF: 'valueOf',
  TO_STRING: 'toString',
  TO_PRIMITIVE: Symbol.toPrimitive,
} as const;

const MOCK_METHOD_NAME = 'mock';

const ERROR_NO_TEST_CONTEXT = 'No active test context';
const ERROR_NOT_SPEC_FILE = 'Moxxy can only be used in test files (.spec.ts). Called from:';

// ============================================================================
// Type Declarations
// ============================================================================

type MockValue = unknown;
type OriginalValue = unknown;
type FunctionMock = (...args: unknown[]) => unknown;
type ObjectMock = Record<string | symbol, unknown>;

type ModuleData = {
  exports: Map<string, MockValue>;
  proxies: Map<string, MockValue>;
};

type MockRegistry = Map<string, MockValue>;

interface MockableProperty {
  mock(mockValue: MockValue): void;
  [key: string]: MockableProperty | ((...args: unknown[]) => unknown);
}

export interface TestInjector {
  reset(): void;
  restore(importName?: string): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

// ============================================================================
// Global State
// ============================================================================

const moduleRegistry = new Map<string, ModuleData>();
const activeTestContext = { current: null as string | null };
const testMocks = new Map<string, MockRegistry>();

// ============================================================================
// Core Registration System
// ============================================================================

export function __moxxy__(
  originalValue: OriginalValue,
  importName: string,
  meta: ImportMeta
): MockValue {
  const modulePath = __getModulePath(meta);
  const moduleData = __getOrCreateModuleData(modulePath);

  moduleData.exports.set(importName, originalValue);

  if (!moduleData.proxies.has(importName)) {
    const proxy = __createGlobalProxy(originalValue, importName);
    moduleData.proxies.set(importName, proxy);
  }

  return moduleData.proxies.get(importName);
}

// ============================================================================
// Module Data Management Helpers
// ============================================================================

function __getOrCreateModuleData(modulePath: string): ModuleData {
  if (!moduleRegistry.has(modulePath)) {
    moduleRegistry.set(modulePath, {
      exports: new Map(),
      proxies: new Map(),
    });
  }
  return moduleRegistry.get(modulePath)!;
}

// ============================================================================
// Function Proxy Creation Helpers
// ============================================================================

function __copyFunctionProperties(proxyFn: Function, originalValue: Function): void {
  Object.setPrototypeOf(proxyFn, originalValue);
  Object.getOwnPropertyNames(originalValue).forEach((key) => {
    if (FUNCTION_PROPS_TO_SKIP.includes(key)) return;

    try {
      (proxyFn as unknown as Record<string, unknown>)[key] = (
        originalValue as unknown as Record<string, unknown>
      )[key];
    } catch {
      // Ignore read-only properties
    }
  });
}

function __createFunctionProxy(originalValue: Function, importName: string): Function {
  const proxyFn = function (this: unknown, ...args: unknown[]) {
    const mockValue = __getActiveMock(importName);
    if (mockValue !== undefined) {
      if (typeof mockValue === 'function') {
        return mockValue.apply(this, args);
      }
      return mockValue;
    }
    return originalValue.apply(this, args);
  };

  __copyFunctionProperties(proxyFn, originalValue);
  return proxyFn;
}

// ============================================================================
// Object Proxy Creation Helpers
// ============================================================================

function __handleNestedPropertyMock(importName: string, propName: string): unknown {
  const nestedMock = __getActiveNestedMock(importName, propName);
  if (nestedMock === undefined) return undefined;

  if (typeof nestedMock === 'function') {
    return function (this: unknown, ...args: unknown[]) {
      return (nestedMock as FunctionMock).apply(this, args);
    };
  }
  return nestedMock;
}

function __handleObjectMock(importName: string, prop: string | symbol): unknown {
  const mockValue = __getActiveMock(importName);
  if (!mockValue || typeof mockValue !== 'object' || mockValue === null) return undefined;
  if (!(prop in mockValue)) return undefined;

  const mockProp = (mockValue as ObjectMock)[prop];
  if (typeof mockProp === 'function') {
    return function (...args: unknown[]) {
      return (mockProp as FunctionMock).apply(mockValue, args);
    };
  }
  return mockProp;
}

function __handleOriginalProperty(
  target: object,
  prop: string | symbol,
  receiver: unknown
): unknown {
  const originalProp = Reflect.get(target, prop, receiver);
  if (typeof originalProp === 'function') {
    return function (...args: unknown[]) {
      return (originalProp as FunctionMock).apply(target, args);
    };
  }
  return originalProp;
}

function __createObjectProxy(originalValue: object, importName: string): object {
  return new Proxy(originalValue, {
    get(target, prop, receiver) {
      const propName = String(prop);

      const nestedMock = __handleNestedPropertyMock(importName, propName);
      if (nestedMock !== undefined) return nestedMock;

      const objectMock = __handleObjectMock(importName, prop);
      if (objectMock !== undefined) return objectMock;

      return __handleOriginalProperty(target, prop, receiver);
    },
  });
}

// ============================================================================
// Primitive Proxy Creation Helpers
// ============================================================================

function __handlePrimitiveConversion(
  importName: string,
  prop: string | symbol,
  originalValue: unknown
): Function | undefined {
  if (prop === PRIMITIVE_METHODS.VALUE_OF || prop === PRIMITIVE_METHODS.TO_PRIMITIVE) {
    return function () {
      const mockValue = __getActiveMock(importName);
      return mockValue !== undefined ? mockValue : originalValue;
    };
  }

  if (prop === PRIMITIVE_METHODS.TO_STRING) {
    return function () {
      const mockValue = __getActiveMock(importName);
      const value = mockValue !== undefined ? mockValue : originalValue;
      return String(value);
    };
  }

  return undefined;
}

function __handlePrimitivePropertyAccess(
  importName: string,
  prop: string | symbol,
  originalValue: unknown
): unknown {
  const mockValue = __getActiveMock(importName);
  const actualValue = mockValue !== undefined ? mockValue : originalValue;

  if (actualValue != null && typeof actualValue === 'object') {
    return (actualValue as ObjectMock)[prop];
  }

  return undefined;
}

function __createPrimitiveProxy(originalValue: unknown, importName: string): object {
  return new Proxy(
    function () {
      const mockValue = __getActiveMock(importName);
      return mockValue !== undefined ? mockValue : originalValue;
    },
    {
      get(target, prop) {
        const conversionHandler = __handlePrimitiveConversion(importName, prop, originalValue);
        if (conversionHandler) return conversionHandler;

        return __handlePrimitivePropertyAccess(importName, prop, originalValue);
      },

      apply() {
        const mockValue = __getActiveMock(importName);
        return mockValue !== undefined ? mockValue : originalValue;
      },

      set() {
        return false;
      },

      has(target, prop) {
        const mockValue = __getActiveMock(importName);
        const actualValue = mockValue !== undefined ? mockValue : originalValue;
        return actualValue != null && prop in Object(actualValue);
      },
    }
  );
}

// ============================================================================
// Main Proxy Creation Function
// ============================================================================

function __createGlobalProxy(originalValue: OriginalValue, importName: string): MockValue {
  if (typeof originalValue === 'function') {
    return __createFunctionProxy(originalValue, importName);
  }

  if (typeof originalValue === 'object' && originalValue !== null) {
    return __createObjectProxy(originalValue, importName);
  }

  return __createPrimitiveProxy(originalValue, importName);
}

// ============================================================================
// Mock Management Functions
// ============================================================================

function __getActiveMock(importName: string): MockValue {
  if (!activeTestContext.current) return undefined;

  const mockRegistry = testMocks.get(activeTestContext.current);
  if (!mockRegistry) return undefined;

  return mockRegistry.get(importName);
}

function __getActiveNestedMock(importName: string, propName: string): MockValue {
  if (!activeTestContext.current) return undefined;

  const mockRegistry = testMocks.get(activeTestContext.current);
  if (!mockRegistry) return undefined;

  return mockRegistry.get(`${importName}.${propName}`);
}

function __setMock(importName: string, mockValue: MockValue): void {
  if (!activeTestContext.current) {
    throw new Error(ERROR_NO_TEST_CONTEXT);
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
// Mockable Property Creation Helpers
// ============================================================================

function __createBasicMockable(importName: string): MockableProperty {
  return {
    mock(mockValue: MockValue) {
      __setMock(importName, mockValue);
    },
  };
}

function __createNestedMockable(importName: string, propName: string): MockableProperty {
  return {
    mock(mockValue: MockValue) {
      __setMock(`${importName}.${propName}`, mockValue);
    },
  };
}

function __createObjectMockableProxy(importName: string, originalValue: object): MockableProperty {
  const mockable = __createBasicMockable(importName);

  return new Proxy(mockable, {
    get(target, prop) {
      if (prop === MOCK_METHOD_NAME) {
        return target.mock;
      }

      const propName = String(prop);
      if (propName in originalValue) {
        return __createNestedMockable(importName, propName);
      }

      return undefined;
    },

    has(target, prop) {
      return prop === MOCK_METHOD_NAME || String(prop) in originalValue;
    },
  });
}

function __createMockableProperty(importName: string, moduleData: ModuleData): MockableProperty {
  const originalValue = moduleData.exports.get(importName);

  if (originalValue && typeof originalValue === 'object') {
    return __createObjectMockableProxy(importName, originalValue);
  }

  return __createBasicMockable(importName);
}

// ============================================================================
// Test Injector Creation Helpers
// ============================================================================

function __createBaseInjector(): TestInjector {
  return {
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
    },
  };
}

function __createFullInjector(moduleData: ModuleData): TestInjector {
  const baseInjector = __createBaseInjector();

  return new Proxy(baseInjector, {
    get(target, prop) {
      if (prop in target) {
        return (target as unknown as Record<string | symbol, unknown>)[prop];
      }

      const importName = String(prop);
      if (moduleData.exports.has(importName)) {
        return __createMockableProperty(importName, moduleData);
      }

      return undefined;
    },

    has(target, prop) {
      return prop in target || moduleData.exports.has(String(prop));
    },
  });
}

function __createTestInjector(testPath: string, targetModulePath: string): TestInjector {
  activeTestContext.current = testPath;

  const moduleData = moduleRegistry.get(targetModulePath);
  if (!moduleData) {
    return __createBaseInjector();
  }

  return __createFullInjector(moduleData);
}

// ============================================================================
// Path Helper Functions
// ============================================================================

function __getModulePath(meta: ImportMeta): string {
  return fileURLToPath(meta.url).replace(new RegExp(`${TS_EXTENSION}$`), '');
}

function __getTestPath(filePath: string): string {
  return filePath
    .replace(new RegExp(`${TS_EXTENSION}$`), '')
    .replace(new RegExp(`${SPEC_EXTENSION}$`), '');
}

function __getTargetModulePath(testPath: string): string {
  return testPath.replace(SPEC_EXTENSION, '');
}

function __validateSpecFile(filePath: string): void {
  if (!filePath.includes(SPEC_DOT)) {
    throw new Error(`${ERROR_NOT_SPEC_FILE} ${filePath}`);
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

function __moxxyMain(meta: ImportMeta): TestInjector {
  const filePath = fileURLToPath(meta.url);
  __validateSpecFile(filePath);

  const testPath = __getTestPath(filePath);
  const targetModulePath = __getTargetModulePath(testPath);

  return __createTestInjector(testPath, targetModulePath);
}

// Export for plugin injection (this powers the global moxxy in spec files)
export { __moxxyMain as __create_moxxy_global_object__ };

// Export as default so it can be imported with any name
export default __moxxyMain;
