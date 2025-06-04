// Global type declarations for Moxxy testing framework
// This file provides type safety for the globally injected moxxy variable

import type { TestInjector } from './moxxy.js';

declare global {
  /**
   * Global moxxy test injector - automatically available in all test files
   *
   * Provides mocking capabilities for imports in the module under test.
   *
   * @example
   * ```ts
   * // In your .spec.ts file:
   * moxxy.fs.mock(() => ({ readFileSync: () => 'mocked content' }));
   * moxxy.someImport.mock('mocked value');
   * moxxy.reset(); // Clear all mocks
   * ```
   */
  const moxxy: TestInjector;
}

export {};
