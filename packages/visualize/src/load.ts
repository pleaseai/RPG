import type { RpgData } from './types'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

/**
 * Resolve a sidecar dep_graph.json path relative to a given `rpg.json` file,
 * mirroring `rpg_visualize.py::resolve_dep_graph_path()`.
 *
 * Resolution order:
 *   1. Explicit `depGraphPath` argument (if provided and exists)
 *   2. `data.dep_graph_file` (relative to `rpgPath`)
 *   3. `dep_graph.json` sibling of `rpgPath`
 *
 * Returns `null` when no sidecar is found (callers typically fall back to
 * the embedded `data.dep_graph` payload).
 */
export async function resolveDepGraphPath(
  rpgPath: string,
  data: RpgData,
  depGraphPath?: string,
): Promise<string | null> {
  // Use the lexical rpgDir for joining (so the returned path matches
  // the user's convention), but realpath it for the containment check
  // so symlinks inside `rpgDir` cannot smuggle a target outside it.
  const rpgDirLex = path.dirname(path.resolve(rpgPath))
  const rpgDirReal = await safeRealpath(rpgDirLex)

  // Explicit caller-supplied path: trusted, used as-is.
  if (depGraphPath) {
    const candidate = path.isAbsolute(depGraphPath)
      ? depGraphPath
      : path.join(rpgDirLex, depGraphPath)
    return (await fileExists(candidate)) ? candidate : null
  }

  // Implicit candidates come from the parsed rpg.json payload, which we
  // treat as untrusted: a malicious `dep_graph_file` like
  // `../../../etc/passwd`, or one that points at a symlink whose target
  // sits outside `rpgDir`, must not be followed.
  const candidates: string[] = []
  if (typeof data.dep_graph_file === 'string' && data.dep_graph_file) {
    candidates.push(data.dep_graph_file)
  }
  candidates.push('dep_graph.json')

  for (const cand of candidates) {
    const resolved = path.resolve(rpgDirLex, cand)
    if (!(await fileExists(resolved)))
      continue
    // Compare canonical paths so symlinks cannot smuggle the target
    // outside rpgDir after the lexical check passes.
    const canonical = await safeRealpath(resolved)
    if (!isInside(rpgDirReal, canonical))
      continue
    return resolved
  }
  return null
}

/** Resolve a path through symlinks, falling back to its lexical form. */
async function safeRealpath(p: string): Promise<string> {
  try {
    return await realpath(p)
  }
  catch {
    return path.resolve(p)
  }
}

/** Return true if `child` lives at or under `parent`. */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Load an `rpg.json` file together with its companion `dep_graph.json`
 * (either embedded in the RPG payload or stored as a sidecar). Mirrors
 * `rpg_visualize.py::load_rpg()`.
 */
export async function loadRpg(
  rpgPath: string,
  depGraphPath?: string,
): Promise<RpgData> {
  const data = JSON.parse(await readFile(rpgPath, 'utf-8')) as RpgData

  const embedded = data.dep_graph
  const hasEmbedded
    = !!embedded
      && typeof embedded === 'object'
      && !!(embedded as { nodes?: unknown }).nodes

  if (depGraphPath || !hasEmbedded) {
    const resolved = await resolveDepGraphPath(rpgPath, data, depGraphPath)
    if (resolved) {
      const dep = JSON.parse(await readFile(resolved, 'utf-8'))
      data.dep_graph = dep
    }
    else if (depGraphPath) {
      throw new Error(`dep_graph.json not found: ${depGraphPath}`)
    }
  }

  return data
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p)
    return s.isFile()
  }
  catch (err) {
    // Genuinely-absent files are not exceptional; anything else (EACCES,
    // EIO, ELOOP, ENAMETOOLONG, etc.) is a user-actionable environment
    // problem that should surface, not be silently treated as missing.
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR')
      return false
    throw err
  }
}
