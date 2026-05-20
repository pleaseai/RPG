import type { RPGConfig } from './rpg'
import path from 'node:path'
import { createLogger } from '@pleaseai/soop-utils/logger'
import { z } from 'zod/v4'

const log = createLogger('meta')

/**
 * Git baseline for incremental sync.
 *
 * Records the commit the RPG was last synced against. The pre-commit /
 * post-merge hooks read this on the next run and take an incremental
 * shortcut from this baseline. Replaces the legacy single-field
 * `github.commit` storage with a richer 4-field record.
 */
export const GitMetaSchema = z.object({
  headCommit: z.string(),
  headShort: z.string().optional().nullable(),
  headBranch: z.string().optional().nullable(),
  headTimestamp: z.string().optional().nullable(),
})

export type GitMeta = z.infer<typeof GitMetaSchema>

export const RPGMetaSchema = z.object({
  version: z.string(),
  rootPath: z.string().optional(),
  github: z.object({
    owner: z.string(),
    repo: z.string(),
    commit: z.string(),
    pathPrefix: z.string().optional(),
  }).optional(),
  /**
   * Git sync baseline. When absent at load time, callers may absorb a
   * legacy `github.commit` into `headCommit` (see `absorbLegacyGithubCommit`).
   */
  git: GitMetaSchema.optional(),
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
 *
 * `gitMeta` is optional and additive — supplied by callers that have
 * read the current HEAD via `readHead()`.
 */
export function serializeMeta(
  config: RPGConfig,
  graphPath?: string,
  gitMeta?: GitMeta,
): RPGMeta {
  return {
    version: '2.0.0',
    rootPath: encodeRootPath(config.rootPath, graphPath),
    github: config.github,
    git: gitMeta,
  }
}

/**
 * Parse a meta object, optionally resolving a relative `rootPath` against
 * the graph file's directory. Absolute `rootPath` values are preserved as-is
 * for backward compatibility with legacy meta files.
 *
 * When `meta.git` is absent but `meta.github.commit` is present, callers
 * can use `absorbLegacyGithubCommit()` to migrate the SHA forward.
 */
export function deserializeMeta(data: unknown, graphPath?: string): RPGMeta {
  const meta = RPGMetaSchema.parse(data)
  if (graphPath && meta.rootPath && !path.isAbsolute(meta.rootPath))
    return { ...meta, rootPath: path.resolve(path.dirname(graphPath), meta.rootPath) }
  return meta
}

// Process-scoped deprecation latch — one warning per process, not per call.
let legacyWarningEmitted = false

/**
 * Absorb a legacy `github.commit` SHA into `git.headCommit` when no
 * `git` baseline is present. Emits a one-time deprecation warning per
 * process so users learn to migrate without log spam.
 *
 * Returns a new RPGMeta object — does not mutate the input.
 */
export function absorbLegacyGithubCommit(meta: RPGMeta): RPGMeta {
  if (meta.git)
    return meta
  const legacy = meta.github?.commit
  if (!legacy)
    return meta

  if (!legacyWarningEmitted) {
    log.warn(
      'meta.github.commit is deprecated; future versions will write meta.git only. '
      + 'Re-run `soop encode` or `soop stamp` to migrate.',
    )
    legacyWarningEmitted = true
  }

  return {
    ...meta,
    git: {
      headCommit: legacy,
      headShort: null,
      headBranch: null,
      headTimestamp: null,
    },
  }
}

/**
 * Test-only: reset the deprecation-warning latch so subsequent calls
 * emit the warning again. Never call from production code paths.
 */
export function _resetLegacyWarningForTests(): void {
  legacyWarningEmitted = false
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
