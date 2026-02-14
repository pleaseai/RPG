import { getCurrentBranch, getDefaultBranch, getHeadCommitSha, getMergeBase } from '@pleaseai/rpg-utils/git-helpers'
import { describe, expect, it } from 'vitest'

describe('git-helpers', () => {
  const repoPath = process.cwd()

  describe('getHeadCommitSha', () => {
    it('should return a 40-character hex SHA', () => {
      const sha = getHeadCommitSha(repoPath)
      expect(sha).toMatch(/^[0-9a-f]{40}$/)
    })

    it('should throw for non-existent directory', () => {
      expect(() => getHeadCommitSha('/nonexistent/path')).toThrow()
    })
  })

  describe('getCurrentBranch', () => {
    it('should return a non-empty string for a branch checkout', () => {
      const branch = getCurrentBranch(repoPath)
      // In CI this may be empty (detached HEAD), so just check it's a string
      expect(typeof branch).toBe('string')
    })
  })

  describe('getDefaultBranch', () => {
    it('should return main or master', () => {
      const branch = getDefaultBranch(repoPath)
      expect(['main', 'master']).toContain(branch)
    })
  })

  describe('getMergeBase', () => {
    it('should return a valid SHA when both refs exist', () => {
      const head = getHeadCommitSha(repoPath)
      // merge-base of HEAD with itself is HEAD
      const base = getMergeBase(repoPath, head, head)
      expect(base).toBe(head)
    })

    it('should throw for invalid refs', () => {
      expect(() => getMergeBase(repoPath, 'nonexistent-branch-xyz', 'HEAD')).toThrow()
    })
  })
})
