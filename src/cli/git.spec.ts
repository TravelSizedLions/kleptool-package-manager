import { describe, it, expect } from 'bun:test';
import git from './git.ts';

function __createSimpleGitMock(
  options: {
    tags?: string[];
    branches?: string[];
    latestCommit?: string;
    shouldThrow?: boolean;
  } = {}
) {
  const { tags = [], branches = [], latestCommit, shouldThrow = false } = options;

  if (shouldThrow) {
    return () => {
      throw new Error('Not a git repository');
    };
  }

  return () => ({
    tags: () => ({ all: tags }),
    branch: () => ({ all: branches }),
    log: () => ({ latest: latestCommit ? { hash: latestCommit } : null }),
  });
}

function __createProcessExecMock(
  options: {
    shouldResolve?: boolean;
    output?: string;
    error?: string;
  } = {}
) {
  const { shouldResolve = true, output = '', error = 'Command failed' } = options;

  if (shouldResolve) {
    return () => Promise.resolve(output);
  } else {
    return () => Promise.reject(new Error(error));
  }
}

async function __testRepositoryType(
  repoPath: string,
  isLocalRepo: boolean,
  localMockOptions: Parameters<typeof __createSimpleGitMock>[0] = {},
  processMockOptions: Parameters<typeof __createProcessExecMock>[0] = {}
) {
  if (isLocalRepo) {
    moxxy.simpleGit.mock(__createSimpleGitMock(localMockOptions));
    moxxy.process.exec.mock(__createProcessExecMock({ shouldResolve: false }));
  } else {
    moxxy.simpleGit.mock(__createSimpleGitMock({ shouldThrow: true }));
    moxxy.process.exec.mock(__createProcessExecMock(processMockOptions));
  }

  return isLocalRepo ? git.isLocalRepository(repoPath) : git.isRemoteRepository(repoPath);
}

async function __testRepositoryStat(
  repoPath: string,
  expected: {
    isLocal: boolean;
    isRemote: boolean;
    tags: string[];
    branches: string[];
  },
  mockConfig: {
    localMockOptions?: Parameters<typeof __createSimpleGitMock>[0];
    processMockOptions?: Parameters<typeof __createProcessExecMock>[0];
  } = {}
) {
  const { localMockOptions = {}, processMockOptions = {} } = mockConfig;

  if (expected.isLocal) {
    moxxy.simpleGit.mock(__createSimpleGitMock(localMockOptions));
    moxxy.process.exec.mock(__createProcessExecMock({ shouldResolve: false }));
  } else {
    moxxy.simpleGit.mock(__createSimpleGitMock({ shouldThrow: true }));
    moxxy.process.exec.mock(__createProcessExecMock(processMockOptions));
  }

  const result = await git.repositoryStat(repoPath);
  expect(result).toEqual(expected);
}

describe('debug', () => {
  it('should show what moxxy can see', () => {
    console.log('Moxxy object:', Object.getOwnPropertyNames(moxxy));
    console.log('Moxxy keys:', Object.keys(moxxy));

    // Test if we can mock process at all
    try {
      moxxy.process.mock({
        exec: () => Promise.resolve('test-output'),
      });
      console.log('Process mock set successfully');
    } catch (e) {
      console.log('Process mock failed:', e);
    }

    // Test if we can access simpleGit
    try {
      console.log('simpleGit in moxxy:', 'simpleGit' in moxxy);
      if ('simpleGit' in moxxy) {
        (moxxy as any).simpleGit.mock(() => ({
          tags: () => ({ all: ['test'] }),
        }));
        console.log('simpleGit mock set successfully');
      }
    } catch (e) {
      console.log('simpleGit mock failed:', e);
    }

    expect(true).toBe(true);
  });
});

describe('isRemoteRepository', () => {
  it('should return true for valid remote repository', async () => {
    const result = await __testRepositoryType(
      'https://github.com/user/repo.git',
      false,
      {},
      { shouldResolve: true, output: 'some-output' }
    );
    expect(result).toBe(true);
  });

  it('should return false for invalid remote repository', async () => {
    const result = await __testRepositoryType(
      'invalid-url',
      false,
      {},
      { shouldResolve: false, error: 'Not found' }
    );
    expect(result).toBe(false);
  });
});

describe('isLocalRepository', () => {
  it('should return true for valid local repository', async () => {
    moxxy.simpleGit.mock(() => ({
      tags: () => ({ all: ['v1.0.0'] }),
      branch: () => ({ all: ['main'] }),
      log: () => ({ latest: { hash: 'abc123' } }),
    }));

    const result = await git.isLocalRepository('/path/to/repo');

    expect(result).toBe(true);
  });

  it('should return false for invalid local repository', async () => {
    moxxy.simpleGit.mock(() => {
      throw new Error('Not a git repository');
    });

    const result = await git.isLocalRepository('/invalid/path');

    expect(result).toBe(false);
  });
});

describe('repositoryStat', () => {
  it('should return repository stats for local repository', async () => {
    moxxy.simpleGit.mock(() => ({
      tags: () => ({ all: ['v1.0.0', 'v1.1.0', 'v2.0.0'] }),
      branch: () => ({ all: ['main', 'develop', 'feature/test'] }),
      log: () => ({ latest: { hash: 'abcd1234567890abcdef1234567890abcdef1234' } }),
    }));

    moxxy.process.exec.mock(() => Promise.reject(new Error('Remote not accessible')));

    const result = await git.repositoryStat('/path/to/local/repo');

    expect(result).toEqual({
      isLocal: true,
      isRemote: false,
      tags: ['v1.0.0', 'v1.1.0', 'v2.0.0'],
      branches: ['main', 'develop', 'feature/test'],
    });
  });

  it('should return repository stats for remote repository', async () => {
    moxxy.simpleGit.mock(() => {
      throw new Error('Not local');
    });

    moxxy.process.exec.mock(() =>
      Promise.resolve(
        'abcd1234567890abcdef1234567890abcdef1234\trefs/tags/v1.0.0\n' +
          '1234567890abcdef1234567890abcdef12345678\trefs/tags/v1.1.0\n' +
          '5678901234567890abcdef1234567890abcdef12\trefs/heads/main\n' +
          '9012345678901234567890abcdef1234567890ab\trefs/heads/develop'
      )
    );

    const result = await git.repositoryStat('https://github.com/user/repo.git');

    expect(result).toEqual({
      isLocal: false,
      isRemote: true,
      tags: ['v1.0.0', 'v1.1.0'],
      branches: ['main', 'develop'],
    });
  });

  it('should throw error for invalid repository', async () => {
    moxxy.simpleGit.mock(() => {
      throw new Error('Not local');
    });

    moxxy.process.exec.mock(() => Promise.reject(new Error('Not remote')));

    await expect(() => git.repositoryStat('invalid-repo')).toThrow();
  });
});

describe('getLatestCommit', () => {
  it('should return latest commit for local repository', async () => {
    moxxy.simpleGit.mock(() => ({
      tags: () => ({ all: ['v1.0.0'] }),
      branch: () => ({ all: ['main'] }),
      log: () => ({ latest: { hash: 'abcd1234567890abcdef1234567890abcdef1234' } }),
    }));

    moxxy.process.exec.mock(() => Promise.reject(new Error('Remote not accessible')));

    const result = await git.getLatestCommit('/path/to/local/repo');

    expect(result).toBe('abcd1234567890abcdef1234567890abcdef1234');
  });

  it('should return latest commit for remote repository', async () => {
    moxxy.simpleGit.mock(() => {
      throw new Error('Not local');
    });

    moxxy.process.exec.mock(() =>
      Promise.resolve(
        'abcd1234567890abcdef1234567890abcdef1234\tHEAD\n' +
          '1234567890abcdef1234567890abcdef12345678\trefs/heads/main'
      )
    );

    const result = await git.getLatestCommit('https://github.com/user/repo.git');

    expect(result).toBe('abcd1234567890abcdef1234567890abcdef1234');
  });

  it('should throw error for empty local repository', async () => {
    moxxy.simpleGit.mock(() => ({
      tags: () => ({ all: [] }),
      branch: () => ({ all: [] }),
      log: () => ({ latest: null }),
    }));

    moxxy.process.exec.mock(() => Promise.reject(new Error('Remote not accessible')));

    await expect(() => git.getLatestCommit('/path/to/empty/repo')).toThrow();
  });

  it('should throw error when no HEAD reference found', async () => {
    moxxy.simpleGit.mock(() => {
      throw new Error('Not local');
    });

    moxxy.process.exec.mock(() =>
      Promise.resolve('1234567890abcdef1234567890abcdef12345678\trefs/heads/main')
    );

    await expect(() => git.getLatestCommit('https://github.com/user/repo.git')).toThrow();
  });
});

describe('getVersionType', () => {
  it('should return "hash" for "latest" version', async () => {
    const result = await git.getVersionType('https://github.com/user/repo.git', 'latest');

    expect(result).toBe('hash');
  });

  it('should return "semver" for semantic version', async () => {
    moxxy.simpleGit.mock(() => ({
      tags: () => ({ all: ['v1.0.0', 'v1.1.0', 'v2.0.0'] }),
      branch: () => ({ all: ['main', 'develop'] }),
    }));

    moxxy.process.exec.mock(() => Promise.reject(new Error('Remote not accessible')));

    const result = await git.getVersionType('/path/to/repo', '1.0.0');

    expect(result).toBe('semver');
  });

  it('should return "branch" for branch name', async () => {
    moxxy.simpleGit.mock(() => ({
      tags: () => ({ all: ['v1.0.0'] }),
      branch: () => ({ all: ['main', 'develop', 'feature/test'] }),
    }));

    moxxy.process.exec.mock(() => Promise.reject(new Error('Remote not accessible')));

    const result = await git.getVersionType('/path/to/repo', 'main');

    expect(result).toBe('branch');
  });

  it('should return "tag" for tag name', async () => {
    moxxy.simpleGit.mock(() => ({
      tags: () => ({ all: ['v1.0.0', 'release-tag'] }),
      branch: () => ({ all: ['main'] }),
    }));

    moxxy.process.exec.mock(() => Promise.reject(new Error('Remote not accessible')));

    const result = await git.getVersionType('/path/to/repo', 'release-tag');

    expect(result).toBe('tag');
  });

  it('should return "hash" for valid commit hash', async () => {
    moxxy.simpleGit.mock(() => ({
      tags: () => ({ all: [] }),
      branch: () => ({ all: [] }),
    }));

    moxxy.process.exec.mock(() => Promise.reject(new Error('Remote not accessible')));

    const validHash = 'abcd1234567890abcdef1234567890abcdef1234';
    const result = await git.getVersionType('/path/to/repo', validHash);

    expect(result).toBe('hash');
  });

  it('should throw error for invalid version', async () => {
    moxxy.simpleGit.mock(() => ({
      tags: () => ({ all: [] }),
      branch: () => ({ all: [] }),
    }));

    moxxy.process.exec.mock(() => Promise.reject(new Error('Remote not accessible')));

    await expect(() => git.getVersionType('/path/to/repo', 'invalid-version')).toThrow();
  });

  it('should handle version constraints', async () => {
    moxxy.simpleGit.mock(() => ({
      tags: () => ({ all: ['v1.0.0', 'v1.1.0'] }),
      branch: () => ({ all: ['main'] }),
    }));

    moxxy.process.exec.mock(() => Promise.reject(new Error('Remote not accessible')));

    const result = await git.getVersionType('/path/to/repo', '^1.0.0');

    expect(result).toBe('semver');
  });
});
