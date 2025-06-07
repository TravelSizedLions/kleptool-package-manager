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

describe('isRemoteRepository', () => {
  it('should return true for valid remote repository', async () => {
    moxxy.simpleGit.mock(__createSimpleGitMock({ shouldThrow: true }));
    moxxy.process.exec.mock(
      __createProcessExecMock({ shouldResolve: true, output: 'some-output' })
    );

    expect(await git.isRemoteRepository('https://github.com/user/repo.git')).toBe(true);
  });

  it('should return false for invalid remote repository', async () => {
    moxxy.simpleGit.mock(__createSimpleGitMock({ shouldThrow: true }));
    moxxy.process.exec.mock(__createProcessExecMock({ shouldResolve: false, error: 'Not found' }));

    expect(await git.isRemoteRepository('invalid-url')).toBe(false);
  });
});

describe('isLocalRepository', () => {
  it('should return true for valid local repository', async () => {
    moxxy.simpleGit.mock(() => ({
      tags: () => ({ all: ['v1.0.0'] }),
      branch: () => ({ all: ['main'] }),
      log: () => ({ latest: { hash: 'abc123' } }),
    }));

    expect(await git.isLocalRepository('/path/to/repo')).toBe(true);
  });

  it('should return false for invalid local repository', async () => {
    moxxy.simpleGit.mock(() => {
      throw new Error('Not a git repository');
    });

    expect(await git.isLocalRepository('/invalid/path')).toBe(false);
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

    expect(await git.repositoryStat('/path/to/local/repo')).toEqual({
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

    expect(await git.repositoryStat('https://github.com/user/repo.git')).toEqual({
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

    expect(await git.getLatestCommit('/path/to/local/repo')).toBe(
      'abcd1234567890abcdef1234567890abcdef1234'
    );
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

    expect(await git.getLatestCommit('https://github.com/user/repo.git')).toBe(
      'abcd1234567890abcdef1234567890abcdef1234'
    );
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
    expect(await git.getVersionType('https://github.com/user/repo.git', 'latest')).toBe('hash');
  });

  it('should return "semver" for semantic version', async () => {
    moxxy.simpleGit.mock(() => ({
      tags: () => ({ all: ['v1.0.0', 'v1.1.0', 'v2.0.0'] }),
      branch: () => ({ all: ['main', 'develop'] }),
    }));

    moxxy.process.exec.mock(() => Promise.reject(new Error('Remote not accessible')));

    expect(await git.getVersionType('/path/to/repo', '1.0.0')).toBe('semver');
  });

  it('should return "branch" for branch name', async () => {
    moxxy.simpleGit.mock(() => ({
      tags: () => ({ all: ['v1.0.0'] }),
      branch: () => ({ all: ['main', 'develop', 'feature/test'] }),
    }));

    moxxy.process.exec.mock(() => Promise.reject(new Error('Remote not accessible')));

    expect(await git.getVersionType('/path/to/repo', 'main')).toBe('branch');
  });

  it('should return "tag" for tag name', async () => {
    moxxy.simpleGit.mock(() => ({
      tags: () => ({ all: ['v1.0.0', 'release-tag'] }),
      branch: () => ({ all: ['main'] }),
    }));

    moxxy.process.exec.mock(() => Promise.reject(new Error('Remote not accessible')));

    expect(await git.getVersionType('/path/to/repo', 'release-tag')).toBe('tag');
  });

  it('should return "hash" for valid commit hash', async () => {
    moxxy.simpleGit.mock(() => ({
      tags: () => ({ all: [] }),
      branch: () => ({ all: [] }),
    }));

    moxxy.process.exec.mock(() => Promise.reject(new Error('Remote not accessible')));

    expect(
      await git.getVersionType('/path/to/repo', 'abcd1234567890abcdef1234567890abcdef1234')
    ).toBe('hash');
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

    expect(await git.getVersionType('/path/to/repo', '^1.0.0')).toBe('semver');
  });
});
