import {
  assertEquals,
  assertExists,
  assertThrows,
} from 'https://deno.land/std@0.220.1/assert/mod.ts'
import { describe, it } from 'https://deno.land/std@0.220.1/testing/bdd.ts'
import {
  isRemoteRepository,
  isLocalRepository,
  isRepository,
  repositoryStat,
  getLatestCommit,
  getVersionType,
} from './git.ts'
import kerror from './kerror.ts'

// Mock data
const VALID_REMOTE_REPO = 'https://github.com/denoland/deno.git'
const INVALID_REPO = 'https://github.com/this-does-not-exist-123456789.git'
const VALID_LOCAL_REPO = './test-fixtures/local-repo'

describe('Git Repository Validation', () => {
  describe('isRemoteRepository', () => {
    it('should return true for valid remote repository', async () => {
      const result = await isRemoteRepository(VALID_REMOTE_REPO)
      assertEquals(result, true)
    })

    it('should return false for invalid remote repository', async () => {
      const result = await isRemoteRepository(INVALID_REPO)
      assertEquals(result, false)
    })
  })

  describe('isLocalRepository', () => {
    it('should return true for valid local repository', async () => {
      // Note: This test requires a local git repository at ./test-fixtures/local-repo
      const result = await isLocalRepository(VALID_LOCAL_REPO)
      assertEquals(result, true)
    })

    it('should return false for invalid local repository', async () => {
      const result = await isLocalRepository('./non-existent-path')
      assertEquals(result, false)
    })
  })

  describe('isRepository', () => {
    it('should return true for valid repository', async () => {
      const result = await isRepository(VALID_REMOTE_REPO)
      assertEquals(result, true)
    })

    it('should return false for invalid repository', async () => {
      const result = await isRepository(INVALID_REPO)
      assertEquals(result, false)
    })
  })
})

describe('Repository Statistics', () => {
  describe('repositoryStat', () => {
    it('should return repository stats for valid remote repository', async () => {
      const stat = await repositoryStat(VALID_REMOTE_REPO)
      assertExists(stat)
      if (stat) {
        assertEquals(stat.isRemote, true)
        assertEquals(stat.isLocal, false)
        assertExists(stat.tags)
        assertExists(stat.branches)
      }
    })

    it('should throw KlepError for invalid repository', async () => {
      await assertThrows(
        async () => await repositoryStat(INVALID_REPO),
        kerror.KlepError,
        'The provided argument is not a valid git repository'
      )
    })
  })
})

describe('Commit and Version Management', () => {
  describe('getLatestCommit', () => {
    it('should return commit hash for valid repository', async () => {
      const commit = await getLatestCommit(VALID_REMOTE_REPO)
      assertExists(commit)
      assertEquals(commit.length, 40) // Git commit hashes are 40 characters
    })

    it('should throw KlepError for invalid repository', async () => {
      await assertThrows(
        async () => await getLatestCommit(INVALID_REPO),
        kerror.KlepError
      )
    })
  })

  describe('getVersionType', () => {
    it('should identify semver version', async () => {
      const type = await getVersionType(VALID_REMOTE_REPO, '1.0.0')
      assertEquals(type, 'semver')
    })

    it('should identify branch', async () => {
      const type = await getVersionType(VALID_REMOTE_REPO, 'main')
      assertEquals(type, 'branch')
    })

    it('should identify tag', async () => {
      const type = await getVersionType(VALID_REMOTE_REPO, 'v1.0.0')
      assertEquals(type, 'tag')
    })

    it('should identify hash', async () => {
      // Note: This test requires a valid commit hash from the repository
      const commit = await getLatestCommit(VALID_REMOTE_REPO)
      const type = await getVersionType(VALID_REMOTE_REPO, commit)
      assertEquals(type, 'hash')
    })

    it('should throw KlepError for invalid version', async () => {
      await assertThrows(
        async () => await getVersionType(VALID_REMOTE_REPO, 'invalid-version'),
        kerror.KlepError,
        'The provided version is not a valid semver version, tag, branch, or hash in this repository'
      )
    })
  })
})
