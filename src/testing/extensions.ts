import { expect } from 'bun:test';
import kerror from '../cli/kerror.ts';

interface KlepErrorMatchers {
  throws(type: string, id: string): void;
  throwsId(id: string): void;
  throwsType(type: string): void;
}

declare module 'bun:test' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars,@typescript-eslint/no-empty-object-type
  interface Matchers<T> extends KlepErrorMatchers {
    // Empty interface used for type extension
  }
}

// Custom matcher for KlepError with both type and id
expect.extend({
  throws: (received: unknown, type: string, id: string) => {
    try {
      if (typeof received !== 'function') {
        return {
          message: () => `expected ${received} to be a function`,
          pass: false,
        };
      }
      (received as () => void)();
      return {
        message: () => `expected error to be a KlepError with type ${type} and id ${id}`,
        pass: false,
      };
    } catch (error) {
      if (kerror.isKlepError(error) && error.type === type && error.id === id) {
        return {
          pass: true,
        };
      }

      return {
        message: () =>
          `expected error to be a KlepError with type ${type} and id ${id}. instead got ${error}`,
        pass: false,
      };
    }
  },
  throwsId: (received: unknown, id: string) => {
    try {
      if (typeof received !== 'function') {
        return {
          message: () => `expected ${received} to be a function`,
          pass: false,
        };
      }
      (received as () => void)();

      return {
        message: () => `expected error to be a KlepError with id ${id}.`,
        pass: false,
      };
    } catch (error) {
      if (kerror.isKlepError(error) && error.id === id) {
        return {
          pass: true,
        };
      }

      return {
        message: () => `expected error to be a KlepError with id ${id}. instead got ${error}`,
        pass: false,
      };
    }
  },
  throwsType: (received: unknown, type: string) => {
    try {
      if (typeof received !== 'function') {
        return {
          message: () => `expected ${received} to be a function`,
          pass: false,
        };
      }
      (received as () => void)();

      return {
        message: () => `expected error to be a KlepError with type ${type}`,
        pass: false,
      };
    } catch (error) {
      if (kerror.isKlepError(error) && error.type === type) {
        return {
          pass: true,
        };
      }

      return {
        message: () => `expected error to be a KlepError with type ${type}. instead got ${error}`,
        pass: false,
      };
    }
  },
});

export {};
