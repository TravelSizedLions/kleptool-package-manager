import git from 'simple-git';
import semver from 'semver';
import { KlepError } from './errors.ts';

type VersionType = 'tag' | 'hash' | 'branch' | 'semver'

const constraints = ['>', '<', '>=', '<=', '!=']

export async function isRemoteRepository(url: string) {
  try {
    await doGitCommand(["ls-remote", url])
    return true;
  } catch {
    return false;
  }
}

export async function isLocalRepository(url: string) {
  try {
    await git(url, {timeout: {block: 10000}})
    return true
  } catch {
    return false;
  }
}

export async function isRepository(url: string) {
  return isRemoteRepository(url) || isLocalRepository(url);
}

export async function assertIsRepository(url: string) {
  const isLocal = await isLocalRepository(url)
  const isRemote = await isRemoteRepository(url)
  if (isLocal || isRemote) {
    return
  }

  if (!isRemote) {
    throw new KlepError({
      type: 'argument',
      id: 'bad-url',
      message: 'The provided url is not a valid git repository',
      context: {
        'provided-value': `"${url}"`,
        'example-values': ['https://github.com/username/repository.git', 'git@github.com:username/repository.git'],
      }
    })
  }

  if (!isLocal) {
    throw new KlepError({
      type: 'argument',
      id: 'bad-path',
      message: 'The provided path is not a valid local git repository',
      context: {
        'provided-value': `"${url}"`,
        'example-values': ['../path/to/local/repo', '/home/user/path/to/local/repo'],
      }
    })
  }
}

export async function getLatestCommit(url: string) {
  if (await isRemoteRepository(url)) {
    const output = await doGitCommand(["ls-remote", url])
    if (!output) {
      throw new KlepError({
        type: 'git',
        id: 'no-remote-refs',
        message: 'Could not get remote refs from repository',
        context: {
          'repository': url
        }
      })
    }

    const lines = output.split('\n').filter(line => line.trim());
    if (lines.length === 0) {
      throw new KlepError({
        type: 'git',
        id: 'empty-remote-repository', 
        message: 'Repository appears to be empty',
        context: {
          'repository': url
        }
      })
    }

    const headLine = lines.find(line => line.includes('HEAD'));
    if (!headLine) {
      throw new KlepError({
        type: 'git',
        id: 'no-remote-head-ref',
        message: 'Could not find HEAD reference in repository',
        context: {
          'repository': url
        }
      })
    }

    const latestCommit = headLine.split('HEAD')[0].trim();
    if (!latestCommit || latestCommit.length !== 40) {
      throw new KlepError({
        type: 'git',
        id: 'invalid-remote-commit-hash',
        message: 'Got invalid commit hash from repository',
        context: {
          'repository': url,
          'commit-hash': latestCommit
        }
      })
    }

    return latestCommit;
  } else if (await isLocalRepository(url)) {
    const repo = await git(url)
    const commits = await repo.log()
    if (commits.all.length === 0) {
      throw new KlepError({
        type: 'git',
        id: 'empty-local-repository',
        message: 'Repository appears to be empty',
      })
    }

    return commits[0].hash
  } else {
    throw new KlepError({
      type: 'argument',
      id: 'invalid-repository',
      message: 'The provided url or path is not a valid git repository',
      context: {
        'provided-value': `"${url}"`,
        'example-values': ['https://github.com/username/repository.git', 'git@github.com:username/repository.git', '../path/to/local/repo', '/home/user/path/to/local/repo'],
      }
    })
  }
}

async function doGitCommand(args: string[], timeout: number = 10000): Promise<string> {
  const result = await Promise.race([
    new Deno.Command("git", {
      args: args,
    }).output(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
  ]);

  if (result.success) {
    return new TextDecoder().decode(result.stdout);
  } else {
    throw new KlepError({
      type: 'git',
      id: 'command-timeout',
      message: 'The git command timed out',
      context: {
        'command': ['git', ...args].join(' '),
        'error': new TextDecoder().decode(result.stderr),
      }
    })
  }
}

export async function getVersionType(url: string, version: string): Promise<VersionType> {
  if (await isRemoteRepository(url)) {
    // For remote repos, use git ls-remote to check branches and tags
    const remoteListing = await doGitCommand(['ls-remote', url]);
    
    const constraint = constraints.find(constraint => version.startsWith(constraint))
    if (constraint) {
      version = version.split(constraint)[1]
    }

    if (semver.valid(version)) {
      return 'semver';
    }

    // Check if version matches a remote branch
    if (remoteListing.includes(`refs/heads/${version}`)) {
      return 'branch';
    }

    // Check if version matches a tag
    if (remoteListing.includes(`refs/tags/${version}`)) {
      return 'tag';
    }

    return 'hash';

  } else if (await isLocalRepository(url)) {
    // For local repos, use simple-git commands
    const repo = await git(url);

    const constraint = constraints.find(constraint => version.startsWith(constraint))
    if (constraint) {
      version = version.split(constraint)[1]
    }

    if (semver.valid(version)) {
      return 'semver';
    }

    if ((await repo.branch()).all.includes(version)) {
      return 'branch';
    }

    if ((await repo.tags()).all.includes(version)) {
      return 'tag';
    }

    return 'hash';
  } else {
    throw new KlepError({
      type: 'argument', 
      id: 'invalid-repository',
      message: 'The provided url or path is not a valid git repository',
      context: {
        'provided-value': `"${url}"`,
        'example-values': ['https://github.com/username/repository.git', 'git@github.com:username/repository.git', '../path/to/local/repo']
      }
    });
  }
}
