import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import keepfile from './keepfile.ts';
import { $ } from '../testing/mod.ts';

const injector = $(import.meta)!;

describe('keepfile', () => {
  afterEach(() => {
    injector.reset();
  });

  describe('initialize', () => {
    it('should initialize the keepfile', () => {
      injector.fs.mock({
        existsSync: () => false,
        writeFileSync: () => {}
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
    it('should load the keepfile', () => {
      injector.fs.existsSync.mock(() => true);
      injector.resources.load.mock(() => ({ dependencies: [] }));

      const result = keepfile.load();
      expect(result).toBeDefined();
    });

    it('should throw an error if the keepfile does not exist', () => {
      injector.fs.existsSync.mock(() => false);

      expect(() => keepfile.load()).toThrow();
    });
  });
});