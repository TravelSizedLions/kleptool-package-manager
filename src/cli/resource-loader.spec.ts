import { describe, it, expect, mock, afterEach, beforeEach } from 'bun:test';
import { z } from 'zod';
import * as resourceLoader from './resource-loader.ts';
import mod from '../testing/mod.ts';
import { readFileSync } from 'node:fs';

const modder = mod(import.meta)

describe('resource-loader', () => {
  afterEach(() => { 
    mock.restore();
  });

  describe('load', () => {
    it.only('should load a resource if it exists', () => {
      const resourcePath = 'test.json';
      modder.mock(readFileSync, () => {test: 'test'})

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