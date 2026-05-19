import type { RPGConfig } from './rpg'
import path from 'node:path'
import { z } from 'zod/v4'

export const RPGMetaSchema = z.object({
  version: z.string(),
  rootPath: z.string().optional(),
  github: z.object({
    owner: z.string(),
    repo: z.string(),
    commit: z.string(),
    pathPrefix: z.string().optional(),
  }).optional(),
})

export type RPGMeta = z.infer<typeof RPGMetaSchema>

export function metaPathFor(graphPath: string): string {
  const dir = path.dirname(graphPath)
  const ext = path.extname(graphPath)
  const base = path.basename(graphPath, ext)
  // Meta companion is always JSON regardless of graph format
  const metaExt = ext === '.jsonl' ? '.json' : ext
  return path.join(dir, `${base}.meta${metaExt}`)
}

/**
 * Serialize RPG config into a portable meta object.
 *
 * When `graphPath` is provided, `rootPath` is stored relative to the graph
 * file's directory so the meta file can be committed and reused on other
 * machines. Without `graphPath`, falls back to absolute (legacy behavior).
 */
export function serializeMeta(config: RPGConfig, graphPath?: string): RPGMeta {
  return {
    version: '2.0.0',
    rootPath: encodeRootPath(config.rootPath, graphPath),
    github: config.github,
  }
}

/**
 * Parse a meta object, optionally resolving a relative `rootPath` against
 * the graph file's directory. Absolute `rootPath` values are preserved as-is
 * for backward compatibility with legacy meta files.
 */
export function deserializeMeta(data: unknown, graphPath?: string): RPGMeta {
  const meta = RPGMetaSchema.parse(data)
  if (graphPath && meta.rootPath && !path.isAbsolute(meta.rootPath)) {
    return { ...meta, rootPath: path.resolve(path.dirname(graphPath), meta.rootPath) }
  }
  return meta
}

function encodeRootPath(rootPath: string | undefined, graphPath: string | undefined): string | undefined {
  if (!rootPath)
    return undefined
  const absoluteRoot = path.resolve(rootPath)
  if (!graphPath)
    return absoluteRoot
  const rel = path.relative(path.dirname(path.resolve(graphPath)), absoluteRoot)
  // Normalize Windows separators to '/' so meta files written on Windows remain
  // portable to POSIX systems. Empty (same-dir) collapses to '.' so deserialize
  // doesn't treat it as absent.
  return rel.split(path.sep).join('/') || '.'
}
