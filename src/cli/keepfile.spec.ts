import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
// Import the target module FIRST to ensure nuclear registration happens
import keepfile from './keepfile.ts';
import { $ } from '../testing/moxxy.ts';

// Create injector AFTER the module is imported and registered
const injector = $(import.meta)!;

describe('keepfile', () => {
  beforeEach(() => {
    injector.reset();
  });

  afterEach(() => {
    keepfile.clear();
  });

  describe('initialize', () => {
    it('should initialize the keepfile', () => {
      injector.fs.mock({
        existsSync: () => false,
        writeFileSync: () => {},
      });

      expect(() => keepfile.initialize()).not.toThrow();
    });

    it('should throw an error if the keepfile already exists', () => {
      injector.fs.existsSync.mock(() => true);

      expect(() => keepfile.initialize()).toThrow();
    });

    it('should initialize the keepfile with the default values', () => {
      injector.fs.existsSync.mock(() => false);
      injector.fs.writeFileSync.mock(() => {});

      expect(() => keepfile.initialize()).not.toThrow();
    });
  });

  describe('load', () => {
    it.skip('should load the keepfile', () => {
      injector.fs.existsSync.mock(() => true);
      // TODO: Fix mocking for nested module dependencies
      // Mock readFileSync from node:fs which is used by resource-loader
      injector['readFileSync'].mock(() => '{"dependencies": []}');

      const result = keepfile.load();
      expect(result).toBeDefined();
    });

    it('should throw an error if the keepfile does not exist', () => {
      injector.fs.existsSync.mock(() => false);

      expect(() => keepfile.load()).toThrow();
    });
  });
});
