/**
 * Silent-fail git helpers for soop's hook + sync internals.
 *
 * Coexists with `@pleaseai/soop-utils/git-helpers` (throwing variants).
 * Use this module when failures should degrade gracefully (hook context,
 * sub-second budget, no user-visible errors). Use `git-helpers` when
 * the caller wants explicit error reporting.
 */

export type { WorkingTreeChangesOptions } from './diff'
export {
  changedFilesBetween,
  mergeBase,
  stagedChanges,
  workingTreeChanges,
} from './diff'

export type { NameStatusResult, ParseNameStatusOptions } from './name-status'
export { parseNameStatus } from './name-status'

export type { GitHead } from './read-head'
export { readHead, runGitReadonly } from './read-head'
