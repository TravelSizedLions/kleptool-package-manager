import { describe, it, expect, mock, afterEach, beforeEach } from 'bun:test';
import { z } from 'zod';
import * as utils from '../testing/utils.ts';

describe('resource-loader', () => {
  afterEach(() => { 
    mock.restore();
  });

  describe('load', () => {
    it('should load a resource if it exists', () => {

    });

    it('should throw an error if the resource does not exist', () => {
  
    });
  });
});