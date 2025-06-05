/**
 * Cross-platform testing utilities
 *
 * These utilities help ensure consistent test behavior across different operating systems
 * without masking legitimate cross-platform issues in production code.
 */

/**
 * Normalizes file paths to use Unix-style separators for consistent test assertions.
 *
 * This should only be used in test assertions where you're comparing captured paths,
 * not in production code or when testing actual path resolution logic.
 *
 * @param path - The path to normalize
 * @returns Path with forward slashes
 *
 * @example
 * ```typescript
 * // In a test capturing command paths:
 * capturedCommand = normalizePath(command);
 * expect(capturedCommand).toBe('/expected/unix/path');
 * ```
 */
export function normalizePath(path: string): string {
  // Convert backslashes to forward slashes
  let normalized = path.replace(/\\/g, '/');

  // For test paths starting with Unix-style roots, strip Windows drive letters
  // This handles cases where path.resolve('/test/path') becomes 'D:/test/path' on Windows
  if (normalized.match(/^[A-Z]:\//)) {
    const unixPath = normalized.substring(2);
    if (unixPath.startsWith('/')) {
      normalized = unixPath;
    }
  }

  return normalized;
}

/**
 * Alias for normalizePath - use when normalizing captured command strings
 * for better semantic clarity in tests.
 */
export const normalizeCommand = normalizePath;
