import { describe, it, expect } from 'bun:test';
import depsfile from './depsfile.ts';

import { $ } from '../testing/moxxy.ts';
import { beforeEach } from 'bun:test';
const moxxy = $(import.meta)!;

describe('DepsFile', () => {
  beforeEach(() => {
    depsfile.clear();
    moxxy.reset();
  });

  describe('load', () => {
    it('can load a deps file', () => {
      const result = depsfile.load();
      expect(result).toBeDefined();
      expect(result.dependencyFolder).toBeDefined();
      expect(result.dependencies).toBeDefined();
    });
  });

  describe('save', () => {
    it('can save a deps file', () => {
      let savedContent = '';
      let savedPath = '';

      // Mock fs module
      moxxy.fs.mock({
        writeFileSync: (path: string, content: string) => {
          savedPath = path;
          savedContent = content;
        },
      });

      // Mock process module
      moxxy.process.mock({
        cwd: () => '/test/project',
      });

      depsfile.save();

      expect(savedPath).toBe('/test/project/klep.deps');
      expect(savedContent).toContain('dependencyFolder');
      expect(savedContent).toContain('dependencies');
    });
  });

  describe('addDependency', () => {
    it('adds a dependencies object the first time a non-dev dependency is added', () => {
      const dep = {
        url: 'https://github.com/test/repo',
        version: '1.0.0',
      };

      depsfile.addDependency('test-dep', dep, false);
      const result = depsfile.load();

      expect(result.dependencies).toBeDefined();
      expect(result.dependencies['test-dep']).toEqual(dep);
    });

    it('adds a devDependencies object the first time a dev dependency is added', () => {
      const dep = {
        url: 'https://github.com/test/dev-repo',
        version: '2.0.0',
      };

      depsfile.addDependency('test-dev-dep', dep, true);
      const result = depsfile.load();

      expect(result.devDependencies).toBeDefined();
      expect(result.devDependencies!['test-dev-dep']).toEqual(dep);
    });

    it('can add a non-dev dependency', () => {
      const dep = {
        url: 'https://github.com/example/lib',
        version: '3.0.0',
        folder: 'custom-lib',
      };

      depsfile.addDependency('example-lib', dep, false);
      const result = depsfile.load();

      expect(result.dependencies['example-lib']).toEqual(dep);
    });

    it('can add a dev dependency', () => {
      const dep = {
        url: 'https://github.com/example/dev-tool',
        version: '1.5.0',
      };

      depsfile.addDependency('dev-tool', dep, true);
      const result = depsfile.load();

      expect(result.devDependencies!['dev-tool']).toEqual(dep);
    });

    it('can override the default dependencyFolder', () => {
      const dep = {
        url: 'https://github.com/test/repo',
        folder: 'special-folder',
      };

      depsfile.addDependency('test-dep', dep, false);
      const result = depsfile.load();

      expect(result.dependencies['test-dep'].folder).toBe('special-folder');
    });

    it('does not specify the dependencyFolder if using the default', () => {
      const dep = {
        url: 'https://github.com/test/repo',
        folder: depsfile.load().dependencyFolder, // Using the default
      };

      depsfile.addDependency('test-dep', dep, false);
      const result = depsfile.load();

      // folder should be removed since it matches the default
      expect(result.dependencies['test-dep'].folder).toBeUndefined();
    });

    it('does not specify the extract rule section if extracting everything', () => {
      const dep = {
        url: 'https://github.com/test/repo',
        extract: 'all' as const,
      };

      depsfile.addDependency('test-dep', dep, false);
      const result = depsfile.load();

      // extract should be removed since it's 'all'
      expect(result.dependencies['test-dep'].extract).toBeUndefined();
    });

    it('includes the extract rule if a non-"all" rule is provided', () => {
      const extractRules = {
        'src/': 'lib/',
        'docs/': 'documentation/',
      };

      const dep = {
        url: 'https://github.com/test/repo',
        extract: extractRules,
      };

      depsfile.addDependency('test-dep', dep, false);
      const result = depsfile.load();

      expect(result.dependencies['test-dep'].extract).toEqual(extractRules);
    });
  });

  describe('exists', () => {
    beforeEach(() => {
      depsfile.clear();

      depsfile.addDependency(
        'existing-dep',
        {
          url: 'https://github.com/existing/repo',
          version: '1.0.0',
        },
        false
      );

      depsfile.addDependency(
        'existing-dev-dep',
        {
          url: 'https://github.com/existing/dev-repo',
          version: '2.0.0',
        },
        true
      );

      depsfile.addDependency(
        'complex-dep',
        {
          url: 'https://github.com/complex/repo',
          version: '3.0.0',
          folder: 'custom',
          extract: { 'src/': 'lib/' },
        },
        false
      );
    });

    it('detects existing dependencies with the same name', () => {
      const dep = {
        url: 'https://github.com/different/repo',
      };

      const result = depsfile.exists('existing-dep', dep);

      expect(result).toBe(false);
    });

    it('detects existing devDependencies with the same name', () => {
      const dep = {
        url: 'https://github.com/different/repo',
      };

      const result = depsfile.exists('existing-dev-dep', dep);

      expect(result).toBe(false);
    });

    it('detects dependencies with a different name but the same rule', () => {
      const dep = {
        url: 'https://github.com/existing/repo',
        version: '1.0.0',
      };

      const result = depsfile.exists('new-name', dep);

      expect(result).toBe(false);
    });

    it('detects devDependencies with a different name but the same rule', () => {
      const dep = {
        url: 'https://github.com/existing/dev-repo',
        version: '2.0.0',
      };

      const result = depsfile.exists('new-dev-name', dep);

      expect(result).toBe(false);
    });

    it('detects when a dependency is truly unique', () => {
      const dep = {
        url: 'https://github.com/completely/new-repo',
        version: '5.0.0',
      };

      const result = depsfile.exists('unique-dep', dep);

      expect(result).toBe(true);
    });

    it('detects when a dev dependency is truly unique', () => {
      const dep = {
        url: 'https://github.com/completely/new-dev-repo',
        version: '6.0.0',
      };

      const result = depsfile.exists('unique-dev-dep', dep);

      expect(result).toBe(true);
    });
  });

  describe('initialize', () => {
    it('throws an error if the deps file already exists', () => {
      moxxy.fs.mock({
        existsSync: () => true,
      });

      expect(() => depsfile.initialize()).toThrow();
    });

    it('saves out a default deps file if non exists', () => {
      let savedContent = '';
      let savedPath = '';

      moxxy.fs.mock({
        existsSync: () => false,
        writeFileSync: (path: string, content: string) => {
          savedPath = path;
          savedContent = content;
        },
      });

      moxxy.process.mock({
        cwd: () => '/test/project',
      });

      depsfile.initialize();

      expect(savedPath).toBe('/test/project/klep.deps');
      expect(savedContent).toContain('dependencyFolder');
      expect(savedContent).toContain('dependencies');
      expect(savedContent).toContain('devDependencies');
    });
  });
});
