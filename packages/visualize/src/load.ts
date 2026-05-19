import type { RpgData } from './types'
import { readFile } from 'node:fs/promises'
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
  const rpgDir = path.dirname(path.resolve(rpgPath))

  if (depGraphPath) {
    const candidate = path.isAbsolute(depGraphPath)
      ? depGraphPath
      : path.join(rpgDir, depGraphPath)
    return (await fileExists(candidate)) ? candidate : null
  }

  const candidates: string[] = []
  if (typeof data.dep_graph_file === 'string' && data.dep_graph_file) {
    candidates.push(data.dep_graph_file)
  }
  candidates.push('dep_graph.json')

  for (const cand of candidates) {
    const resolved = path.isAbsolute(cand) ? cand : path.join(rpgDir, cand)
    if (await fileExists(resolved))
      return resolved
  }
  return null
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
    const { stat } = await import('node:fs/promises')
    const s = await stat(p)
    return s.isFile()
  }
  catch {
    return false
  }
}
