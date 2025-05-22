import git from 'simple-git';
import semver from 'semver';
import { KlepError } from './errors.ts';

type VersionType = 'tag' | 'hash' | 'branch' | 'semver'

const COMMIT_LENGTH = 40
const hashRegex = new RegExp(`^[0-9a-f]{${COMMIT_LENGTH}}$`)

const constraints = ['>', '<', '>=', '<=', '!=']

type RepositoryStat = {
  isLocal: boolean
  isRemote: boolean
  tags: string[]
  branches: string[]
}

async function getRemoteTags(url: string) {
  return (await doGitCommand(['ls-remote', url]))
    .split('\n')
    .filter(line => line.trim())
    .filter(line => line.startsWith('refs/tags/'))
    .map(line => line.split('refs/tags/')[1].trim())
}

async function getRemoteBranches(url: string) {
  return (await doGitCommand(['ls-remote', url]))
    .split('\n')
    .filter(line => line.trim())
    .filter(line => line.startsWith('refs/heads/'))
    .map(line => line.split('refs/heads/')[1].trim())
}

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

export async function repositoryStat(url: string): Promise<RepositoryStat | undefined> {
  const [isLocal, isRemote] = await Promise.all([isLocalRepository(url), isRemoteRepository(url)])
  if (isLocal || isRemote) {
    return {
      isLocal,
      isRemote,
      tags: isLocal ? (await git(url).tags()).all : await getRemoteTags(url),
      branches: isLocal ? (await git(url).branch()).all : await getRemoteBranches(url),
    }
  }

  throw new KlepError({
    type: 'argument',
    id: 'bad-git-repository',
    message: 'The provided argument is not a valid git repository',
    context: {
      'provided-value': `"${url}"`,
      'example-values': [
        'https://github.com/username/repository.git',
        'git@github.com:username/repository.git',
        '../path/to/local/repo',
        '/home/user/path/to/local/repo',
      ],
    }
  })
}

export async function getLatestCommit(url: string) {
  const repo = await repositoryStat(url)
  if (!repo) {
    return
  }

  if (repo.isLocal) {
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
  }

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
  if (!latestCommit || !hashRegex.test(latestCommit)) {
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
}

async function doGitCommand(args: string[], timeout: number = 10000): Promise<string> {
  const command = new Deno.Command("git", {
    args: args,
  })

  const result = await Promise.race([
    command.output(),
    new Promise((_, reject) => setTimeout(() => reject(new Error()), timeout))
  ])

  if (result.success) {
    return new TextDecoder().decode(result.stdout);
  }

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

function removeVersionConstraint(version: string): string {
  const constraint = constraints.find(constraint => version.startsWith(constraint))
  if (constraint) {
    return version.split(constraint)[1]
  }
  return version
}

function normalizeVersion(version: string): string {
  if (!semver.valid(version)) {
    return version
  }

  const normalized = removeVersionConstraint(version)
  if (normalized.startsWith('v')) {
    return normalized.slice(1)
  }

  return normalized
}

async function versionIsAvailable(stat: RepositoryStat, url: string,version: string): Promise<boolean> {
  const normalized = normalizeVersion(version)
  if (!semver.valid(normalized) && !semver.valid(version)) { 
    return false
  }

  return stat.tags.includes(normalized) || stat.tags.includes(version)
}

export async function getVersionType(url: string, version: string): Promise<VersionType> {
  const repo = await repositoryStat(url)
  if (!repo) {
    throw new KlepError({type: 'argument', id: 'invalid-repository'})
  }

  if (await versionIsAvailable(repo, url, version)) {
    return 'semver'
  }

  const staticVersion = removeVersionConstraint(version)
  if (repo.branches.includes(staticVersion)) {
    return 'branch'
  }

  if (repo.tags.includes(staticVersion)) {
    return 'tag'
  }

  return 'hash'
}
