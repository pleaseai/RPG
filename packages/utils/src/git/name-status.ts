/**
 * Parsed result of `git diff -M --name-status`.
 *
 * - `modified`: every path that must be re-examined (adds, deletes, modifications,
 *   and rename targets — the NEW path of a rename is included so callers re-parse it)
 * - `renames`: `{ oldPath: newPath }` so callers can pass it straight into a
 *   dependency-graph `updateFiles({ renames })` call
 */
export interface NameStatusResult {
  modified: string[]
  renames: Record<string, string>
}

export interface ParseNameStatusOptions {
  /**
   * Extensions to keep. Default: `['.ts', '.tsx', '.js', '.jsx', '.py']`.
   * Pass `null` to disable filtering and keep every path.
   */
  filterExt?: readonly string[] | null
}

const DEFAULT_FILTER_EXT: readonly string[] = ['.ts', '.tsx', '.js', '.jsx', '.py']

/**
 * Parse output of `git diff --name-status -M`.
 *
 * Status codes recognised: `A` (added), `D` (deleted), `M` (modified),
 * `R<score>` (rename, score optional), `C<score>` (copy — treated as rename).
 * Other codes (`T` type change, `U` unmerged, ...) are silently ignored;
 * callers fall back to a full sync via the safety threshold when many of
 * them appear.
 *
 * Silent-fail: `null` / `undefined` input returns `{ modified: [], renames: {} }`.
 */
export function parseNameStatus(
  raw: string | null | undefined,
  options: ParseNameStatusOptions = {},
): NameStatusResult {
  const modified: string[] = []
  const renames: Record<string, string> = {}
  if (!raw)
    return { modified, renames }

  const filterExt = options.filterExt === undefined ? DEFAULT_FILTER_EXT : options.filterExt
  const keep = (p: string): boolean => {
    if (filterExt === null)
      return true
    return filterExt.some(ext => p.endsWith(ext))
  }

  // Normalize CRLF and split on LF.
  const lines = raw.replace(/\r\n/g, '\n').split('\n')

  for (const line of lines) {
    if (!line)
      continue
    const parts = line.split('\t')
    if (parts.length < 2)
      continue

    const status = parts[0]
    if (!status)
      continue

    if (status.startsWith('R') || status.startsWith('C')) {
      if (parts.length < 3)
        continue
      const oldPath = parts[1]
      const newPath = parts[2]
      if (!oldPath || !newPath)
        continue
      if (keep(newPath) || keep(oldPath)) {
        renames[oldPath] = newPath
        if (keep(newPath))
          modified.push(newPath)
      }
      continue
    }

    const path = parts[1]
    if (!path || !keep(path))
      continue

    if (status === 'A' || status === 'D' || status === 'M')
      modified.push(path)
    // Other status codes (T, U, ...) are intentionally ignored.
  }

  return { modified, renames }
}
