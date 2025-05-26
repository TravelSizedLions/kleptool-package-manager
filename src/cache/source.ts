import git from '../git.ts';

type _Source = {
  url: string;
};

export type Source = RemoteGitSource | LocalGitSource;

export type RemoteGitSource = _Source & {
  type: 'remote-git';
};

export type LocalGitSource = _Source & {
  type: 'local-git';
};

// type RemoteZipSource = Source & {
//   type: 'remote-zip'
// }

// type LocalZipSource = Source & {
//   type: 'local-zip'
// }

async function create(url: string): Promise<Source> {
  const repo = await git.repositoryStat(url);

  return {
    url,
    type: repo.isLocal ? 'local-git' : 'remote-git',
  };
}

async function clone(source: Source) {
  if (source.type === 'local-git') {
    return git.clone(source.url, path);
  }
}

export default {
  create,
};
