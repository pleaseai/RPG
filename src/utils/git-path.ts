import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

let cachedGitPath: string | undefined

/**
 * Build list of candidate file names for the git binary.
 *
 * On Windows, executables may have extensions listed in PATHEXT
 * (e.g. `.exe`, `.cmd`). On Unix, only the bare name `git` is checked.
 */
function gitCandidateNames(): string[] {
  const names = ['git']
  const pathExt = process.env.PATHEXT
  if (pathExt) {
    for (const ext of pathExt.split(';').filter(Boolean)) {
      names.push(`git${ext.toLowerCase()}`)
    }
  }
  return names
}

/**
 * Resolve the absolute path to the `git` binary by searching PATH directories.
 *
 * Mitigates CWE-426 (Untrusted Search Path) / CWE-427 (Uncontrolled Search Path Element)
 * by explicitly resolving and caching the executable path instead of relying on
 * implicit PATH resolution in child_process calls.
 *
 * On Windows, checks PATHEXT extensions (`.exe`, `.cmd`, etc.) in addition
 * to the bare `git` name.
 *
 * @throws {Error} if git is not found in any PATH directory
 */
export function resolveGitBinary(): string {
  if (cachedGitPath)
    return cachedGitPath

  const dirs = (process.env.PATH ?? '').split(delimiter)
  const names = gitCandidateNames()
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name)
      try {
        accessSync(candidate, constants.X_OK)
        cachedGitPath = candidate
        return candidate
      }
      catch {
        continue
      }
    }
  }

  throw new Error(
    'git binary not found in PATH. '
    + 'Install git or set PATH to include the directory containing git.',
  )
}

/**
 * Clear the cached git path (for testing purposes).
 */
export function clearGitPathCache(): void {
  cachedGitPath = undefined
}
