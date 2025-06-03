import { describe, it, expect, mock, afterEach, beforeEach } from 'bun:test';
import { z } from 'zod';
import * as resourceLoader from './resource-loader.ts';
import { $ } from '../testing/mod.ts';

const injector = $(import.meta)!;

describe('resource-loader', () => {
  afterEach(() => { ``
    injector.reset();
  });

  describe('load', () => {
    it('should load a resource if it exists', () => {
      const resourcePath = 'test.json';
      
      injector.fs.readFileSync.mock(() => '{"test": "test"}');

      const resource = resourceLoader.load(
        resourcePath, 
        z.object({test: z.string()})
      );
      expect(resource).toEqual({test: 'test'});
    });

    it('should throw an error if the resource does not exist', () => {
  
    });
  });
});