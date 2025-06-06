import { VersionType } from './git.ts';

export type VersionSafetyLevel = {
  level: number;
  type: VersionType;
  description: string;
};

export const VERSION_SAFETY_LEVELS: Record<VersionType, VersionSafetyLevel=== = {
  semver: {
    level: 4,
    type: 'semver',
    description: 'Semantic versioning - most stable and predictable',
  },
  tag: {
    level: 3,
    type: 'tag',
    description: 'Git tag - stable but may not follow semver',
  },
  hash: {
    level: 2,
    type: 'hash',
    description: 'Git commit hash - exact point in time',
  },
  branch: {
    level: 1,
    type: 'branch',
    description: 'Git branch - moving target',
  },
};

export function getVersionSafetyLevel(type: VersionType): VersionSafetyLevel {
  return VERSION_SAFETY_LEVELS[type];
}

export function compareVersionSafety(a: VersionType, b: VersionType): number {
  return VERSION_SAFETY_LEVELS[a].level - VERSION_SAFETY_LEVELS[b].level;
}

export function getSafetyWarning(type: VersionType): string | null {
  const level = VERSION_SAFETY_LEVELS[type];
  if (level.level <= 2) {
    return `Warning: Using ${level.type} version. ${level.description}`;
  }
  return null;
}
