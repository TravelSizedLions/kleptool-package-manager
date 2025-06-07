import path from 'node:path';
import os from 'node:os';

const home = os.homedir();

export default {
  cache: {
    path: path.join(home, '.kleptool', 'cache'),
    ttl: 60 * 60 * 24 * 30, // 30 days
  },
  depsfile: {
    dependencyFolder: path.join(home, '.dependencies'),
    entry: {
      dependencyFolder: path.join(home, '.dependencies'),
      dependencies: {},
      devDependencies: {},
    },
  },
  keepfile: [],
};
