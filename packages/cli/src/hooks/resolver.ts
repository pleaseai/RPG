import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { runGitReadonly } from '@pleaseai/soop-utils/git'

/**
 * Read `git config --get core.hooksPath` for `projectPath`, returning the
 * resolved absolute path (or `null` when unset / git unavailable / outside
 * a checkout). Relative paths and leading `~` are expanded against the
 * project root and `$HOME` respectively, matching git's own rules.
 *
 * Why this matters: teams using husky / pre-commit / lefthook routinely
 * override `core.hooksPath` to point at a checked-in directory
 * (e.g. `.husky/_/`). Writing into `.git/hooks/` in that case is a
 * silent no-op — git never reads from there.
 */
export function readCoreHooksPath(projectPath: string): string | null {
  const value = runGitReadonly(['config', '--get', 'core.hooksPath'], projectPath)
  if (!value)
    return null
  // Expand ~ against $HOME so e.g. `core.hooksPath = ~/dotfiles/hooks` behaves
  // like git's own expansion.
  let expanded = value
  if (expanded.startsWith('~/') || expanded === '~')
    expanded = path.join(homedir(), expanded.slice(1))
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(projectPath, expanded)
}

/**
 * Locate the `hooks/` directory git will read for `projectPath`.
 *
 * Resolution order:
 *   1. `core.hooksPath` override (honors husky / lefthook / pre-commit)
 *   2. Plain repo: `.git/` is a directory → `.git/hooks`
 *   3. Worktree: `.git` is a file with `gitdir: <path>` first line
 *        - if gitdir's parent dir basename is `worktrees` → main repo
 *          shares hooks at `<main>/.git/hooks` (two levels up)
 *        - otherwise (`--separate-git-dir`) → `<gitdir>/hooks`
 *   4. No git checkout → `null`
 *
 * Returns `null` so callers can skip hook installation cleanly outside
 * a git workspace.
 */
export function resolveGitHooksDir(projectPath: string): string | null {
  if (!projectPath || !existsSync(projectPath))
    return null

  const custom = readCoreHooksPath(projectPath)
  if (custom)
    return custom

  const gitMarker = path.join(projectPath, '.git')
  if (!existsSync(gitMarker))
    return null

  let isDir = false
  let isFile = false
  try {
    const s = statSync(gitMarker)
    isDir = s.isDirectory()
    isFile = s.isFile()
  }
  catch {
    return null
  }

  if (isDir)
    return path.join(gitMarker, 'hooks')

  if (isFile) {
    let content: string
    try {
      content = readFileSync(gitMarker, 'utf-8').trim()
    }
    catch {
      return null
    }
    if (!content.startsWith('gitdir:'))
      return null
    const gitdirValue = content.slice('gitdir:'.length).trim()
    if (!gitdirValue)
      return null
    const gitdirPath = path.isAbsolute(gitdirValue)
      ? gitdirValue
      : path.resolve(projectPath, gitdirValue)
    // Linked worktrees live at <main>/.git/worktrees/<name>/. Hooks for the
    // whole repo are shared at <main>/.git/hooks, two levels up.
    if (path.basename(path.dirname(gitdirPath)) === 'worktrees')
      return path.join(path.dirname(path.dirname(gitdirPath)), 'hooks')
    return path.join(gitdirPath, 'hooks')
  }

  return null
}
