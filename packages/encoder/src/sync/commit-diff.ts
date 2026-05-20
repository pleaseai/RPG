import type { GitMeta } from '@pleaseai/soop-graph/meta'
import {
  changedFilesBetween,
  mergeBase,
  readHead,
  stagedChanges,
  workingTreeChanges,
} from '@pleaseai/soop-utils/git'

/**
 * Cap on the number of `.ts`/`.py`/... files that incremental mode will
 * touch before the safety net kicks in and forces a full rebuild.
 * Tuned for medium repos; callers can override via the `fileLimit` option.
 */
export const DEFAULT_INCREMENTAL_FILE_LIMIT = 50

export type SyncMode = 'noop' | 'incremental' | 'full'

export interface SyncDecisionOptions {
  /** Skip the decision tree and force a full rebuild. */
  forceFull?: boolean
  /**
   * When `true`, scope dirty-tree checks to the index (`git diff --cached`)
   * — the pre-commit hook semantic. Working-tree-only-not-staged changes
   * are ignored. Default: `false` (manual CLI use).
   */
  stagedOnly?: boolean
  /**
   * Threshold above which incremental falls back to full. Defaults to
   * `DEFAULT_INCREMENTAL_FILE_LIMIT` (50).
   */
  fileLimit?: number
}

export interface SyncDecision {
  mode: SyncMode
  reason: string
  lastCommit: string | null
  currentCommit: string | null
  /** Files to refresh (incremental mode); empty for noop / full. */
  changed: string[]
  /** Old → new rename pairs (incremental mode only). */
  renames: Record<string, string>
  /**
   * Suggested git baseline after a successful sync. Callers SHOULD write
   * this to `meta.git` once their post-sync work has succeeded. `null`
   * when the workspace isn't a git checkout (no `meta.git` to advance).
   */
  nextGitMeta: GitMeta | null
  /**
   * For `mode === 'noop'`: branch/timestamp values whose drift the caller
   * may want to refresh in-place even though `headCommit` is unchanged.
   * Populated only when the values actually differ from the last meta.
   */
  metaDrift: {
    headBranch?: string | null
    headTimestamp?: string | null
  } | null
}

/**
 * Decide the sync mode for `repoPath` against the previously-recorded
 * `lastGitMeta`. Pure-ish: only reads git state, never mutates the graph.
 *
 * Decision tree:
 *
 *   forceFull=true                       → full        (reason: force_full)
 *   gitMeta missing OR not in git repo   → full        (reason: baseline / no_git)
 *   last == HEAD & clean                 → noop        (reason: head_unchanged_clean)
 *   last == HEAD & dirty                 → incremental (reason: head_unchanged_dirty)
 *   mergeBase(last, HEAD) == last        → incremental (reason: linear)
 *   mergeBase != last                    → full        (reason: diverged)
 *   changed.length > fileLimit           → full        (reason: over_limit_{N}>{L})
 *
 * The "dirty" check uses `stagedChanges` when `stagedOnly=true`,
 * `workingTreeChanges` otherwise.
 *
 * The "linear advance" branch unions `changedFilesBetween(last, HEAD)`
 * with the caller's chosen scope (staged or working tree), so staged
 * extras land in the same incremental pass.
 *
 * Caller is responsible for executing the chosen mode (calling
 * `encoder.evolve(...)` for incremental, full rebuild for full, etc.)
 * and then writing `nextGitMeta` to disk.
 */
export function decideSyncFromCommitDiff(
  repoPath: string,
  lastGitMeta: GitMeta | null | undefined,
  options: SyncDecisionOptions = {},
): SyncDecision {
  const limit = options.fileLimit ?? DEFAULT_INCREMENTAL_FILE_LIMIT
  const stagedOnly = options.stagedOnly ?? false

  const currentHead = readHead(repoPath)
  const lastCommit = lastGitMeta?.headCommit ?? null
  const currentCommit = currentHead?.headCommit ?? null

  const nextGitMeta: GitMeta | null = currentHead
    ? {
        headCommit: currentHead.headCommit,
        headShort: currentHead.headShort,
        headBranch: currentHead.headBranch,
        headTimestamp: currentHead.headTimestamp,
      }
    : null

  const empty = (mode: SyncMode, reason: string): SyncDecision => ({
    mode,
    reason,
    lastCommit,
    currentCommit,
    changed: [],
    renames: {},
    nextGitMeta,
    metaDrift: null,
  })

  if (options.forceFull)
    return empty('full', 'force_full')

  if (lastCommit === null)
    return empty('full', 'baseline')

  if (currentCommit === null)
    return empty('full', 'no_git')

  // HEAD unchanged — look at dirty files only.
  if (lastCommit === currentCommit) {
    const dirty = stagedOnly
      ? stagedChanges(repoPath)
      : workingTreeChanges(repoPath)
    const hasChanges = dirty.modified.length > 0 || Object.keys(dirty.renames).length > 0
    if (!hasChanges) {
      // Detect branch / timestamp drift so the caller can refresh
      // those fields in-place without advancing headCommit.
      const drift: { headBranch?: string | null, headTimestamp?: string | null } = {}
      if (currentHead && lastGitMeta) {
        if (lastGitMeta.headBranch !== currentHead.headBranch)
          drift.headBranch = currentHead.headBranch
        if (lastGitMeta.headTimestamp !== currentHead.headTimestamp)
          drift.headTimestamp = currentHead.headTimestamp
      }
      return {
        mode: 'noop',
        reason: 'head_unchanged_clean',
        lastCommit,
        currentCommit,
        changed: [],
        renames: {},
        nextGitMeta,
        metaDrift: Object.keys(drift).length > 0 ? drift : null,
      }
    }
    // Over-limit safety net also applies in the head-unchanged-dirty branch.
    if (dirty.modified.length > limit) {
      return empty('full', `over_limit_${dirty.modified.length}>${limit}`)
    }
    return {
      mode: 'incremental',
      reason: 'head_unchanged_dirty',
      lastCommit,
      currentCommit,
      changed: [...dirty.modified],
      renames: { ...dirty.renames },
      nextGitMeta,
      metaDrift: null,
    }
  }

  // HEAD advanced — is it linear?
  const base = mergeBase(repoPath, lastCommit, currentCommit)
  if (base !== lastCommit)
    return empty('full', 'diverged')

  // Linear advance: union of last..HEAD diff + staged-or-working extras.
  const between = changedFilesBetween(repoPath, lastCommit, currentCommit)
  const extra = stagedOnly ? stagedChanges(repoPath) : workingTreeChanges(repoPath)
  const changed: string[] = [...between.modified]
  const seen = new Set(changed)
  for (const p of extra.modified) {
    if (!seen.has(p)) {
      changed.push(p)
      seen.add(p)
    }
  }
  // Renames from the broader scope override commit-range pairs (they
  // describe the most recent moves).
  const renames = { ...between.renames, ...extra.renames }

  if (changed.length > limit)
    return empty('full', `over_limit_${changed.length}>${limit}`)

  return {
    mode: 'incremental',
    reason: 'linear',
    lastCommit,
    currentCommit,
    changed,
    renames,
    nextGitMeta,
    metaDrift: null,
  }
}
