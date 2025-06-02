import { mock } from 'bun:test';
import _defaults from '../cli/defaults.ts';
import * as _ from 'es-toolkit';

// Current behavior state - this gets updated by tests
let currentBehavior = {
  existsSync: (path: string) => false,
  writeFileSync: (path: string, data: any, options?: any) => {},
  mkdirSync: (path: string, options?: any) => {},
  readFileSync: (path: string, options?: any) => '{}',
};

// Mock state with dynamic functions that read from currentBehavior
let mockState = {
  existsSync: (path: string) => currentBehavior.existsSync(path),
  writeFileSync: (path: string, data: any, options?: any) => currentBehavior.writeFileSync(path, data, options),
  mkdirSync: (path: string, options?: any) => currentBehavior.mkdirSync(path, options),
  readFileSync: (path: string, options?: any) => currentBehavior.readFileSync(path, options),
};

// Set up the module mocks once when preloaded
mock.module('node:fs', () => {
  return {
    default: mockState,
    ...mockState, // Also provide named exports
  };
});

// Also mock the file.ts wrapper
mock.module('../cli/file.ts', () => {
  return {
    default: mockState,
    fs: mockState,
  };
});

// Mock defaults.ts - this will be dynamically updated by tests
let defaultsState: typeof _defaults = _.cloneDeep(_defaults);

mock.module('../cli/defaults.ts', () => {
  return {
    default: defaultsState,
  };
});

// Export controllers for tests to modify behavior
export const fs = {
  get: () => currentBehavior,
  set: (newBehavior: Partial<typeof currentBehavior>) => {
    Object.assign(currentBehavior, newBehavior);
  },
  reset: () => {
    currentBehavior = {
      existsSync: (path: string) => false,
      writeFileSync: (path: string, data: any, options?: any) => {},
      mkdirSync: (path: string, options?: any) => {},
      readFileSync: (path: string, options?: any) => '{}',
    };
  },
};

export const defaults = {
  get: () => defaultsState,
  set: (newDefaults: Partial<typeof defaultsState>) => {
    Object.assign(defaultsState, newDefaults);
  },
  reset: () => {
    defaultsState = _.cloneDeep(_defaults);
  }
};
