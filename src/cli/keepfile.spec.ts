import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import keepfile from './keepfile.ts';

describe('keepfile', () => {
  beforeEach(() => {
    moxxy.reset();
  });

  afterEach(() => {
    keepfile.clear();
  });

  describe('initialize', () => {
    it('should initialize the keepfile', () => {
      moxxy.fs.mock({
        existsSync: () => false,
        writeFileSync: () => {},
      });

      expect(() => keepfile.initialize()).not.toThrow();
    });

    it('should throw an error if the keepfile already exists', () => {
      moxxy.fs.existsSync.mock(() => true);

      expect(() => keepfile.initialize()).toThrow();
    });

    it('should initialize the keepfile with the default values', () => {
      moxxy.fs.existsSync.mock(() => false);
      moxxy.fs.writeFileSync.mock(() => {});

      expect(() => keepfile.initialize()).not.toThrow();
    });
  });

  describe('load', () => {
    it.skip('should load the keepfile', () => {
      moxxy.fs.existsSync.mock(() => true);
      // TODO: Fix mocking for nested module dependencies
      // Mock readFileSync from node:fs which is used by resource-loader
      moxxy['readFileSync'].mock(() => '{"dependencies": []}');

      const result = keepfile.load();
      expect(result).toBeDefined();
    });

    it('should throw an error if the keepfile does not exist', () => {
      moxxy.fs.existsSync.mock(() => false);
      expect(() => keepfile.load()).toThrow();
    });
  });
});
