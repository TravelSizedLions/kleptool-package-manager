import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import '../testing/extensions.ts';
import { DependencyGraph } from './schemas/klep.keep.schema.ts';
import * as utils from '../testing/utils.ts';
import keepfile from './keepfile.ts';
import { fs as fsMock, defaults as defaultsMock } from '../testing/mock-prefixes.ts';

describe('keepfile', () => {

  beforeEach(async () => {
    fsMock.reset(); // Reset to defaults
    defaultsMock.reset(); // Reset to defaults
    keepfile.clear(); // Clear cached keepfile
  });

  afterEach(() => { 
    mock.restore();
    fsMock.reset();
    defaultsMock.reset();
    keepfile.clear();
  });

  describe('initialize', () => {
    it('should initialize the keepfile', () => {
      expect(keepfile.initialize()).toBeDefined();
    });

    it('should throw an error if the keepfile already exists', () => {
      fsMock.set({
        existsSync: () => true
      });
      
      expect(() => keepfile.initialize()).throwsId('klep-file-exists');
    });

    it('should initialize the keepfile with the default values', () => {
      const result = keepfile.initialize();
      expect(result).toEqual(utils.to<DependencyGraph>(defaultsMock.get().keepfile));
    });
  });

  describe('load', () => {
    it('should load the keepfile', () => {
      fsMock.set({
        existsSync: () => true
      });

      mock.module('./resource-loader.ts', () => {
        return {
          load: () => {
            return {
              this: 'this',
              is: 'is',
              a: 'a',
              test: 'test',
            }
          } 
        }
      });

      expect(keepfile.load()).toEqual(utils.to<DependencyGraph>({
        this: 'this',
        is: 'is',
        a: 'a',
        test: 'test',
      }));
    });
    
    it('should throw an error if the keepfile does not exist', () => {
      fsMock.set({
        existsSync: () => false
      });
      
      expect(() => keepfile.load()).throwsId('klep-file-not-found');
    });
  }); 

});