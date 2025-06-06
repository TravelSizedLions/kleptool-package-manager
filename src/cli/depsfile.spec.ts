import { describe, it, expect } from 'bun:test';
import depsfile from './depsfile.ts';
import path from 'node:path';
import { beforeEach } from 'bun:test';

function __createMockFS() {
  let savedContent = '';
  let savedPath = '';

  return {
    mock: {
      writeFileSync: (filePath: string, content: string) => {
        savedPath = filePath;
        savedContent = content;
      },
    },
    getSavedPath: () => savedPath,
    getSavedContent: () => savedContent,
  };
}

function __createMockProcess(cwd = '/test/project') {
  return {
    cwd: () => cwd,
  };
}

function __setupMocksAndSave(projectPath = '/test/project') {
  const fsMock = __createMockFS();

  moxxy.fs.mock(fsMock.mock);
  moxxy.process.mock(__createMockProcess(projectPath));

  depsfile.save();

  const expectedPath = path.join(projectPath, 'klep.deps');
  expect(path.normalize(fsMock.getSavedPath())).toBe(path.normalize(expectedPath));
  expect(fsMock.getSavedContent()).toContain('dependencyFolder');
  expect(fsMock.getSavedContent()).toContain('dependencies');

  return fsMock;
}

function __addTestDependency(
  name: string,
  dep: any,
  isDev: boolean,
  expectedSection: 'dependencies' | 'devDependencies' = isDev ? 'devDependencies' : 'dependencies'
) {
  depsfile.addDependency(name, dep, isDev);
  const result = depsfile.load();

  expect(result[expectedSection]).toBeDefined();
  if (isDev) {
    expect(result.devDependencies![name]).toEqual(dep);
  } else {
    expect(result.dependencies[name]).toEqual(dep);
  }

  return result;
}

function __setupComplexDependencies() {
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
}

beforeEach(() => {
  depsfile.clear();
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
    __setupMocksAndSave();
  });
});

describe('addDependency', () => {
  it('adds a dependencies object the first time a non-dev dependency is added', () => {
    const dep = {
      url: 'https://github.com/test/repo',
      version: '1.0.0',
    };

    __addTestDependency('test-dep', dep, false);
  });

  it('adds a devDependencies object the first time a dev dependency is added', () => {
    const dep = {
      url: 'https://github.com/test/dev-repo',
      version: '2.0.0',
    };

    __addTestDependency('test-dev-dep', dep, true);
  });

  it('can add a non-dev dependency', () => {
    const dep = {
      url: 'https://github.com/example/lib',
      version: '3.0.0',
      folder: 'custom-lib',
    };

    __addTestDependency('example-lib', dep, false);
  });

  it('can add a dev dependency', () => {
    const dep = {
      url: 'https://github.com/example/dev-tool',
      version: '1.5.0',
    };

    __addTestDependency('dev-tool', dep, true);
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

    expect(result.dependencies['test-dep'].folder).toBeUndefined();
  });

  it('does not specify the extract rule section if extracting everything', () => {
    const dep = {
      url: 'https://github.com/test/repo',
      extract: 'all' as const,
    };

    depsfile.addDependency('test-dep', dep, false);
    const result = depsfile.load();

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
    __setupComplexDependencies();
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
    const fsMock = __createMockFS();

    moxxy.fs.mock({
      existsSync: () => false,
      ...fsMock.mock,
    });
    moxxy.process.mock(__createMockProcess());

    depsfile.initialize();

    const expectedPath = path.join('/test/project', 'klep.deps');
    expect(path.normalize(fsMock.getSavedPath())).toBe(path.normalize(expectedPath));
    expect(fsMock.getSavedContent()).toContain('dependencyFolder');
    expect(fsMock.getSavedContent()).toContain('dependencies');
    expect(fsMock.getSavedContent()).toContain('devDependencies');
  });
});
