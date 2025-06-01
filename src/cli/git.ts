import { simpleGit } from 'simple-git';
import semver from 'semver';
import kerror from './kerror.ts';
import process from './process.ts';

export type VersionType = 'tag' | 'hash' | 'branch' | 'semver';

const COMMIT_LENGTH = 40;
const hashRegex = new RegExp(`^[0-9a-f]{${COMMIT_LENGTH}}$`);
const tagsRegex = new RegExp(`refs/tags/`);
const branchesRegex = new RegExp(`refs/heads/`);
const constraints = ['^', '~', '<', '>=', '<=', '!='];

type RepositoryStat = {
  isLocal: boolean;
  isRemote: boolean;
  tags: string[];
  branches: string[];
};

async function __getRemoteTags(url: string) {
  return (await __git(['ls-remote', url]))
    .split('\n')
    .filter((line) => line.trim())
    .filter((line) => tagsRegex.test(line))
    .map((line) => line.split('refs/tags/')[1].trim());
}

async function __getRemoteBranches(url: string) {
  return (await __git(['ls-remote', url]))
    .split('\n')
    .filter((line) => line.trim())
    .filter((line) => branchesRegex.test(line))
    .map((line) => line.split('refs/heads/')[1].trim());
}

export async function isRemoteRepository(url: string) {
  try {
    await __git(['ls-remote', url]);
    return true;
  } catch {
    return false;
  }
}

export async function isLocalRepository(url: string) {
  try {
    await simpleGit(url, { timeout: { block: 10000 } });
    return true;
  } catch {
    return false;
  }
}

export function isRepository(url: string) {
  return isRemoteRepository(url) || isLocalRepository(url);
}

export async function repositoryStat(url: string): Promise<RepositoryStat> {
  const [isLocal, isRemote] = await Promise.all([isLocalRepository(url), isRemoteRepository(url)]);

  if (!(isLocal || isRemote)) {
    throw kerror(kerror.type.Argument, 'bad-git-repository', {
      message: 'The provided argument is not a valid git repository',
      context: {
        'provided value': `"${url}"`,
        'example values': [
          'https://github.com/username/repository.git',
          'git@github.com:username/repository.git',
          '../path/to/local/repo',
          '/home/user/path/to/local/repo',
        ],
      },
    });
  }

  return {
    isLocal,
    isRemote,
    tags: isLocal ? (await simpleGit(url).tags()).all : await __getRemoteTags(url),
    branches: isLocal ? (await simpleGit(url).branch()).all : await __getRemoteBranches(url),
  };
}

export async function getLatestCommit(url: string) {
  const repo = await repositoryStat(url);
  if (!repo) {
    throw kerror(kerror.type.Argument, 'invalid-repository', {
      message: 'Could not get repository information',
      context: {
        repository: url,
      },
    });
  }

  if (repo.isLocal) {
    const repo = await simpleGit(url);
    const commits = await repo.log();

    try {
      if (!commits.latest) {
        throw kerror(kerror.type.Git, 'empty-local-repository', {
          message: 'Repository appears to be empty',
        });
      }
      return commits.latest.hash;
    } catch {
      throw kerror(kerror.type.Git, 'empty-local-repository', {
        message: 'Repository appears to be empty',
      });
    }
  }

  // Handle remote repositories more carefully
  const output = await __git(['ls-remote', url]);
  if (!output) {
    throw kerror(kerror.type.Git, 'no-remote-refs', {
      message: 'Could not get remote refs from repository',
      context: {
        repository: url,
      },
    });
  }

  const lines = output.split('\n').filter((line) => line.trim());
  if (lines.length === 0) {
    throw kerror(kerror.type.Git, 'empty-remote-repository', {
      message: 'Repository appears to be empty',
      context: {
        repository: url,
      },
    });
  }

  const headLine = lines.find((line) => line.includes('HEAD'));
  if (!headLine) {
    throw kerror(kerror.type.Git, 'no-remote-head-ref', {
      message: 'Could not find HEAD reference in repository',
      context: {
        repository: url,
      },
    });
  }

  const latestCommit = headLine.split('HEAD')[0].trim();
  if (!latestCommit || !__isValidHash(latestCommit)) {
    throw kerror(kerror.type.Git, 'invalid-remote-commit-hash', {
      message: 'Got invalid commit hash from repository',
      context: {
        repository: url,
        'commit hash': latestCommit,
      },
    });
  }

  return latestCommit;
}

async function __git(args: string[], timeout: number = 10000): Promise<string> {
  return await process.exec('git', { args, timeout });
}

function __removeVersionConstraint(version: string): string {
  const constraint = constraints.find((constraint) => version.startsWith(constraint));
  if (constraint) {
    return version.split(constraint)[1];
  }
  return version;
}

function semanticVersionIsAvailable(stat: RepositoryStat, _url: string, version: string): boolean {
  const normalized = semver.coerce(version);
  if (!semver.valid(normalized) && !semver.valid(version)) {
    return false;
  }

  return stat.tags.some((tag) => {
    const normalizedTag = semver.coerce(tag);
    return (
      (normalizedTag && normalized && normalizedTag.toString() === normalized.toString()) ||
      (normalizedTag && normalizedTag.toString() === version) ||
      (normalized && normalized.toString() === tag)
    );
  });
}

function __isValidHash(version: string): boolean {
  return hashRegex.test(version);
}

export async function getVersionType(url: string, version: string): Promise<VersionType> {
  if (version === 'latest') {
    return 'hash';
  }

  const repo = await repositoryStat(url);
  if (!repo) {
    throw kerror(kerror.type.Argument, 'invalid-repository');
  }

  if (await semanticVersionIsAvailable(repo, url, version)) {
    return 'semver';
  }

  const staticVersion = __removeVersionConstraint(version);
  if (repo.branches.includes(staticVersion)) {
    return 'branch';
  }

  if (repo.tags.includes(staticVersion)) {
    return 'tag';
  }

  if (__isValidHash(staticVersion)) {
    return 'hash';
  }

  throw kerror(kerror.type.Argument, 'invalid-version', {
    message:
      'The provided version is not a valid semver version, tag, branch, or hash in this repository',
    context: {
      'provided value': `"${version}"`,
      repository: url,
      'available tags': repo.tags,
      'available branches': repo.branches,
    },
  });
}

export default {
  isRemoteRepository,
  isLocalRepository,
  repositoryStat,
  getLatestCommit,
  getVersionType,
};
