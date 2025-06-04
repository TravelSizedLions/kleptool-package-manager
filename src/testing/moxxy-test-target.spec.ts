import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

// Import the target module (this should trigger moxxy transformation)
import * as target from './moxxy-test-target.ts';

// Import moxxy system for testing
import { $ } from './moxxy.ts';

describe('Moxxy Unit Tests', () => {
  let moxxy: ReturnType<typeof $>;

  beforeEach(() => {
    moxxy = $(import.meta)!;
  });

  afterEach(() => {
    if (moxxy) {
      moxxy.reset();
    }
  });

  describe('Import Detection', () => {
    it('should detect all imports from target module', () => {
      console.log('=== IMPORT DETECTION TEST ===');
      
      const expectedImports = [
        'defaultFunction',
        'namedFunction', 
        'namedConstant',
        'testObject',
        'TestClass',
        'namespace'
      ];

      for (const importName of expectedImports) {
        const detected = importName in moxxy;
        console.log(`${importName}: ${detected}`);
        expect(detected).toBe(true);
      }
    });
  });

  describe('Basic Function Mocking', () => {
    it('should work without mocks (baseline)', () => {
      expect(target.useDefault('test')).toBe('default-test');
      expect(target.useNamed('test')).toBe('named-test');
    });

    it('should mock default function import', () => {
      (moxxy as any).defaultFunction.mock(() => 'mocked-default');
      
      expect(target.useDefault('test')).toBe('mocked-default');
    });

    it('should mock named function import', () => {
      (moxxy as any).namedFunction.mock(() => 'mocked-named');
      
      expect(target.useNamed('test')).toBe('mocked-named');
    });
  });

  describe('Object Property Mocking', () => {
    it('should mock object methods', () => {
      (moxxy as any).testObject.method1.mock(() => 'mocked-method1');
      
      expect(target.useObjectMethod('test')).toBe('mocked-method1');
    });

    it('should mock object properties', () => {
      // Mock the entire object
      (moxxy as any).testObject.mock({
        property: 'mocked-property',
        method1: (arg: string) => `mocked-method1-${arg}`
      });
      
      expect(target.useObjectProperty()).toBe('mocked-property');
      expect(target.useObjectMethod('test')).toBe('mocked-method1-test');
    });
  });

  describe('Class Mocking', () => {
    it('should mock class constructor', () => {
      const MockClass = function(value: string) {
        return { getValue: () => `mocked-${value}` };
      };
      
      (moxxy as any).TestClass.mock(MockClass);
      
      expect(target.useClass('test')).toBe('mocked-test');
    });
  });

  describe('Constant Mocking', () => {
    it('should mock constants', () => {
      (moxxy as any).namedConstant.mock('mocked-constant');
      
      expect(target.useConstant()).toBe('mocked-constant');
    });
  });

  describe('Nested Object Mocking', () => {
    it('should mock deeply nested properties', () => {
      (moxxy as any).namespace.mock({
        nested: {
          deep: {
            func: (arg: string) => `mocked-deep-${arg}`
          }
        }
      });
      
      expect(target.useNamespace('test')).toBe('mocked-deep-test');
    });
  });

  describe('Test Isolation', () => {
    it('should isolate mocks between tests - first test', () => {
      (moxxy as any).defaultFunction.mock(() => 'first-test-mock');
      
      expect(target.useDefault('test')).toBe('first-test-mock');
    });

    it('should isolate mocks between tests - second test', () => {
      // This should use the original function, not the mock from the previous test
      expect(target.useDefault('test')).toBe('default-test');
      
      // Set a different mock
      (moxxy as any).defaultFunction.mock(() => 'second-test-mock');
      
      expect(target.useDefault('test')).toBe('second-test-mock');
    });
  });

  describe('Mock Management', () => {
    it('should clear individual mocks with restore', () => {
      (moxxy as any).defaultFunction.mock(() => 'mocked');
      (moxxy as any).namedFunction.mock(() => 'also-mocked');
      
      expect(target.useDefault('test')).toBe('mocked');
      expect(target.useNamed('test')).toBe('also-mocked');
      
      moxxy.restore('defaultFunction');
      
      expect(target.useDefault('test')).toBe('default-test'); // Restored
      expect(target.useNamed('test')).toBe('also-mocked'); // Still mocked
    });

    it('should clear all mocks with reset', () => {
      (moxxy as any).defaultFunction.mock(() => 'mocked');
      (moxxy as any).namedFunction.mock(() => 'also-mocked');
      
      expect(target.useDefault('test')).toBe('mocked');
      expect(target.useNamed('test')).toBe('also-mocked');
      
      moxxy.reset();
      
      expect(target.useDefault('test')).toBe('default-test');
      expect(target.useNamed('test')).toBe('named-test');
    });
  });
}); 