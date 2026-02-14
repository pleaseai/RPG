import { execFileSync } from 'node:child_process'
import { resolveGitBinary } from './git-path'

/**
 * Execute a git command and return trimmed stdout.
 */
function git(repoPath: string, args: string[]): string {
  const gitBin = resolveGitBinary()
  return execFileSync(gitBin, args, {
    cwd: repoPath,
    encoding: 'utf-8',
    timeout: 10_000,
  }).trim()
}

/**
 * Get the current HEAD commit SHA.
 */
export function getHeadCommitSha(repoPath: string): string {
  return git(repoPath, ['rev-parse', 'HEAD'])
}

/**
 * Compute the merge-base (common ancestor) of two branches.
 */
export function getMergeBase(repoPath: string, branch1: string, branch2: string): string {
  return git(repoPath, ['merge-base', branch1, branch2])
}

/**
 * Get the current branch name (empty string if detached HEAD).
 */
export function getCurrentBranch(repoPath: string): string {
  try {
    return git(repoPath, ['symbolic-ref', '--short', 'HEAD'])
  }
  catch {
    return ''
  }
}

/**
 * Get the default branch name (main or master).
 */
export function getDefaultBranch(repoPath: string): string {
  try {
    // Check remote HEAD reference
    const ref = git(repoPath, ['symbolic-ref', 'refs/remotes/origin/HEAD'])
    return ref.replace('refs/remotes/origin/', '')
  }
  catch {
    // Fallback: check if main or master exists locally
    try {
      git(repoPath, ['rev-parse', '--verify', 'main'])
      return 'main'
    }
    catch {
      try {
        git(repoPath, ['rev-parse', '--verify', 'master'])
        return 'master'
      }
      catch {
        return 'main'
      }
    }
  }
}
