import type { NameStatusResult, ParseNameStatusOptions } from './name-status'
import { existsSync, statSync } from 'node:fs'
import { parseNameStatus } from './name-status'
import { runGitReadonly } from './read-head'

/**
 * Common pre-check: `repoDir` must be a non-empty string pointing at an
 * existing directory. Silent-fail otherwise.
 */
function validRepoDir(repoDir: string | null | undefined): repoDir is string {
  if (!repoDir || typeof repoDir !== 'string')
    return false
  if (!existsSync(repoDir))
    return false
  try {
    return statSync(repoDir).isDirectory()
  }
  catch {
    return false
  }
}

const EMPTY: NameStatusResult = Object.freeze({ modified: [], renames: {} }) as NameStatusResult

/**
 * Files in the index (i.e. `git add`'d) vs HEAD.
 *
 * Used by the pre-commit hook: at hook time the new commit hasn't been
 * recorded yet, so the right scope is "what's about to be committed" =
 * index vs HEAD. Anything in the working tree that hasn't been `git add`'d
 * is intentionally out of scope.
 *
 * Silent-fail returns `{ modified: [], renames: {} }`.
 */
export function stagedChanges(
  repoDir: string | null | undefined,
  options: ParseNameStatusOptions = {},
): NameStatusResult {
  if (!validRepoDir(repoDir))
    return { modified: [], renames: {} }

  let raw = runGitReadonly(['diff', '--cached', '--name-status', '-M', 'HEAD'], repoDir)
  if (raw === null) {
    // HEAD may not exist yet (unborn branch); try without it so the
    // very first commit's staged files still get picked up.
    raw = runGitReadonly(['diff', '--cached', '--name-status', '-M'], repoDir)
  }
  return parseNameStatus(raw, options)
}

export interface WorkingTreeChangesOptions extends ParseNameStatusOptions {
  /** Include untracked files (as additions). Default: `true`. */
  includeUntracked?: boolean
}

/**
 * Tracked-and-modified + (optionally) untracked paths vs HEAD.
 *
 * Used by the manual `soop sync` invocation (without `--staged-only`).
 * Covers everything dirty on disk, regardless of whether it's been
 * `git add`'d. Untracked files are reported as additions (no rename
 * pairing — they have no git history).
 *
 * Silent-fail returns `{ modified: [], renames: {} }`.
 */
export function workingTreeChanges(
  repoDir: string | null | undefined,
  options: WorkingTreeChangesOptions = {},
): NameStatusResult {
  if (!validRepoDir(repoDir))
    return { modified: [], renames: {} }

  const { includeUntracked = true, ...parseOptions } = options
  const raw = runGitReadonly(['diff', '--name-status', '-M', 'HEAD'], repoDir)
  const result = parseNameStatus(raw, parseOptions)

  if (includeUntracked) {
    const untracked = runGitReadonly(['ls-files', '--others', '--exclude-standard'], repoDir)
    if (untracked) {
      const filterExt = parseOptions.filterExt === undefined
        ? ['.ts', '.tsx', '.js', '.jsx', '.py']
        : parseOptions.filterExt
      const keep = (p: string): boolean => {
        if (filterExt === null)
          return true
        return filterExt.some(ext => p.endsWith(ext))
      }
      for (const raw of untracked.split('\n')) {
        const line = raw.trim()
        if (!line)
          continue
        if (keep(line) && !result.modified.includes(line))
          result.modified.push(line)
      }
    }
  }
  return result
}

/**
 * `.ts`/`.py`/... changes between two arbitrary commits / refs.
 *
 * Workhorse for incremental sync: `oldRef` is the commit RPG was last
 * synced against (from `meta.git.headCommit`) and `newRef` is typically
 * the current HEAD. Git stitches together every intermediate commit's
 * diff, so "user committed 5 times since last sync" is handled
 * naturally.
 *
 * Silent-fail returns `{ modified: [], renames: {} }`. An empty list
 * is ambiguous: "no relevant files changed" or "oldRef doesn't exist
 * any more in the current history". Callers should consult
 * `mergeBase()` first to disambiguate.
 */
export function changedFilesBetween(
  repoDir: string | null | undefined,
  oldRef: string | null | undefined,
  newRef: string = 'HEAD',
  options: ParseNameStatusOptions = {},
): NameStatusResult {
  if (!validRepoDir(repoDir) || !oldRef)
    return { modified: [], renames: {} }
  const raw = runGitReadonly(
    ['diff', '--name-status', '-M', `${oldRef}..${newRef}`],
    repoDir,
  )
  return parseNameStatus(raw, options)
}

/**
 * Longest common ancestor commit of `refA` and `refB`.
 *
 * Used to decide whether `meta.git.headCommit` is still on the current
 * history:
 *   - `mergeBase(last, HEAD) == last` → linear advance, safe to diff
 *     `last..HEAD` for incremental update.
 *   - `mergeBase(last, HEAD) != last` → history was rewritten (rebase,
 *     amend, reset, branch fork); must fall back to full sync.
 *
 * Returns `null` on any failure — caller treats this as "diverged".
 */
export function mergeBase(
  repoDir: string | null | undefined,
  refA: string | null | undefined,
  refB: string | null | undefined,
): string | null {
  if (!validRepoDir(repoDir) || !refA || !refB)
    return null
  return runGitReadonly(['merge-base', refA, refB], repoDir)
}

// Re-export NameStatusResult shape for callers that import from this module.
export type { NameStatusResult, ParseNameStatusOptions }

// Suppress unused-import warning for EMPTY in lint setups that catch it.
void EMPTY
