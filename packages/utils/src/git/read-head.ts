import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { resolveGitBinary } from '../git-path'

export interface GitHead {
  headCommit: string
  headShort: string | null
  headBranch: string | null
  headTimestamp: string | null
}

const DEFAULT_TIMEOUT_MS = 5000

/**
 * Run a read-only git command. Returns stdout (trimmed) on success,
 * `null` on any failure. Never throws.
 *
 * Public so other silent-fail helpers in this package can share the
 * same subprocess discipline (5s timeout, no env leak, no mutation).
 */
export function runGitReadonly(
  args: string[],
  cwd: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): string | null {
  let gitBin: string
  try {
    gitBin = resolveGitBinary()
  }
  catch {
    return null
  }

  try {
    const result = spawnSync(gitBin, args, {
      cwd,
      encoding: 'utf-8',
      timeout: timeoutMs,
    })
    if (result.error || result.status !== 0)
      return null
    const out = (result.stdout || '').trim()
    return out.length > 0 ? out : null
  }
  catch {
    return null
  }
}

/**
 * Read the current git HEAD for `repoDir`.
 *
 * Returns `null` when:
 *   - `repoDir` is empty / non-string / does not exist
 *   - `git` is not on PATH
 *   - `repoDir` is not a git working tree
 *   - the repository has no commits yet (unborn HEAD)
 *
 * Otherwise returns `{ headCommit, headShort, headBranch, headTimestamp }`.
 * Individual fields may be `null` on best-effort failures (detached HEAD has
 * no branch; very old git versions may not support `--short` etc.).
 *
 * Designed for SessionStart / pre-commit hook use — must never raise and
 * completes well under 1 second on a healthy repo.
 */
export function readHead(repoDir: string | null | undefined): GitHead | null {
  if (!repoDir || typeof repoDir !== 'string')
    return null
  if (!existsSync(repoDir))
    return null
  try {
    if (!statSync(repoDir).isDirectory())
      return null
  }
  catch {
    return null
  }

  // Shared deadline budget — DEFAULT_TIMEOUT_MS for the *whole* function,
  // not per-call. Without this, four sequential calls would each get a
  // fresh 5s allowance, allowing total runtime to drift well past the
  // sub-second budget hooks expect.
  const startMs = Date.now()
  const remaining = (): number => Math.max(50, DEFAULT_TIMEOUT_MS - (Date.now() - startMs))

  const headCommit = runGitReadonly(['rev-parse', 'HEAD'], repoDir, remaining())
  if (!headCommit)
    return null

  const headShort = runGitReadonly(['rev-parse', '--short', 'HEAD'], repoDir, remaining())
  // `symbolic-ref` fails on detached HEAD; runGitReadonly returns null, keep as null.
  const headBranch = runGitReadonly(['symbolic-ref', '--short', 'HEAD'], repoDir, remaining())
  // ISO 8601 UTC timestamp of the HEAD commit.
  const headTimestamp = runGitReadonly(['show', '-s', '--format=%cI', 'HEAD'], repoDir, remaining())

  return { headCommit, headShort, headBranch, headTimestamp }
}
