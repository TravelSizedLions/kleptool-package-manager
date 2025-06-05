/**
 * Windows Path Simulation for Testing
 *
 * This utility allows local development on Unix systems to simulate Windows-style
 * path behavior during tests to catch cross-platform issues before they hit CI.
 */

import {
  join,
  resolve,
  dirname,
  basename,
  extname,
  isAbsolute,
  normalize,
  relative,
  sep,
} from 'node:path';

// Windows path characteristics
const WIN_SEP = '\\';
const WIN_DRIVE_PATTERN = /^[A-Z]:\\/;

type WindowsPathModule = {
  join: (...paths: string[]) => string;
  resolve: (...paths: string[]) => string;
  dirname: (path: string) => string;
  basename: (path: string, ext?: string) => string;
  extname: (path: string) => string;
  isAbsolute: (path: string) => boolean;
  normalize: (path: string) => string;
  relative: (from: string, to: string) => string;
  sep: string;
};

let isWindowsSimulationEnabled = false;
let mockDrive = 'C:';

export function enableWindowsPathSimulation(drive: string = 'C:'): void {
  isWindowsSimulationEnabled = true;
  mockDrive = drive.endsWith(':') ? drive : `${drive}:`;
}

export function disableWindowsPathSimulation(): void {
  isWindowsSimulationEnabled = false;
}

export function isSimulationEnabled(): boolean {
  return isWindowsSimulationEnabled;
}

function __toWindowsPath(path: string): string {
  if (!path) return path;

  // Convert forward slashes to backslashes
  let winPath = path.replace(/\//g, WIN_SEP);

  // Handle absolute paths that don't have drive letters
  if (winPath.startsWith(WIN_SEP) && !WIN_DRIVE_PATTERN.test(winPath)) {
    winPath = mockDrive + winPath;
  }

  return winPath;
}

function __fromWindowsPath(path: string): string {
  if (!path) return path;

  // Remove drive letter for Unix compatibility
  let unixPath = path.replace(WIN_DRIVE_PATTERN, '/');

  // Convert backslashes to forward slashes
  unixPath = unixPath.replace(/\\/g, '/');

  return unixPath;
}

function __simulatedJoin(...paths: string[]): string {
  if (!isWindowsSimulationEnabled) {
    return join(...paths);
  }

  const result = join(...paths);
  return __toWindowsPath(result);
}

function __simulatedResolve(...paths: string[]): string {
  if (!isWindowsSimulationEnabled) {
    return resolve(...paths);
  }

  const result = resolve(...paths);
  return __toWindowsPath(result);
}

function __simulatedDirname(path: string): string {
  if (!isWindowsSimulationEnabled) {
    return dirname(path);
  }

  const unixPath = __fromWindowsPath(path);
  const result = dirname(unixPath);
  return __toWindowsPath(result);
}

function __simulatedBasename(path: string, ext?: string): string {
  if (!isWindowsSimulationEnabled) {
    return basename(path, ext);
  }

  const unixPath = __fromWindowsPath(path);
  return basename(unixPath, ext);
}

function __simulatedExtname(path: string): string {
  if (!isWindowsSimulationEnabled) {
    return extname(path);
  }

  const unixPath = __fromWindowsPath(path);
  return extname(unixPath);
}

function __simulatedIsAbsolute(path: string): boolean {
  if (!isWindowsSimulationEnabled) {
    return isAbsolute(path);
  }

  return WIN_DRIVE_PATTERN.test(path) || path.startsWith(WIN_SEP);
}

function __simulatedNormalize(path: string): string {
  if (!isWindowsSimulationEnabled) {
    return normalize(path);
  }

  const unixPath = __fromWindowsPath(path);
  const result = normalize(unixPath);
  return __toWindowsPath(result);
}

function __simulatedRelative(from: string, to: string): string {
  if (!isWindowsSimulationEnabled) {
    return relative(from, to);
  }

  const unixFrom = __fromWindowsPath(from);
  const unixTo = __fromWindowsPath(to);
  const result = relative(unixFrom, unixTo);
  return __toWindowsPath(result);
}

export function createWindowsPathMock(): WindowsPathModule {
  return {
    join: __simulatedJoin,
    resolve: __simulatedResolve,
    dirname: __simulatedDirname,
    basename: __simulatedBasename,
    extname: __simulatedExtname,
    isAbsolute: __simulatedIsAbsolute,
    normalize: __simulatedNormalize,
    relative: __simulatedRelative,
    sep: isWindowsSimulationEnabled ? WIN_SEP : sep,
  };
}

// Convenience function for moxxy integration
export function mockWindowsPaths(): void {
  if (typeof global !== 'undefined' && 'moxxy' in global) {
    const moxxy = (global as unknown as { moxxy?: { path?: { mock?: (mock: unknown) => void } } })
      .moxxy;
    if (moxxy && typeof moxxy.path === 'object' && typeof moxxy.path.mock === 'function') {
      moxxy.path.mock(createWindowsPathMock());
    }
  }
}

export default {
  enableWindowsPathSimulation,
  disableWindowsPathSimulation,
  isSimulationEnabled,
  createWindowsPathMock,
  mockWindowsPaths,
};
