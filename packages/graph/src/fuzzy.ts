import type { Node } from './node'
import type { RepositoryPlanningGraph } from './rpg'
import path from 'node:path'

/**
 * Maximum suggestions returned by suggestNodes.
 */
const DEFAULT_SUGGEST_LIMIT = 5

/**
 * Compute Levenshtein distance between two strings.
 * Lower is more similar; 0 means identical.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b)
    return 0
  if (a.length === 0)
    return b.length
  if (b.length === 0)
    return a.length

  let prev: number[] = Array.from<number>({ length: b.length + 1 })
  let curr: number[] = Array.from<number>({ length: b.length + 1 })
  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        curr[j - 1]! + 1,
        prev[j]! + 1,
        prev[j - 1]! + cost,
      )
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }

  return prev[b.length]!
}

/**
 * Compute a similarity ratio in [0, 100] between two strings.
 * 100 means identical; 0 means completely different.
 */
export function similarityRatio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0)
    return 100
  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase())
  const maxLen = Math.max(a.length, b.length)
  return Math.round(((maxLen - distance) / maxLen) * 100)
}

/**
 * Score a candidate string against a query.
 * Higher is better. Combines substring containment and Levenshtein similarity.
 *
 * Tiers (mirrors Python rapidfuzz-based suggestion ordering):
 *   100 — exact match
 *    90 — query is a prefix or suffix of candidate
 *    80 — query is a substring of candidate
 *    60 — candidate is a substring of query
 *  0-55 — Levenshtein-similarity-scaled (so substring always beats fuzzy)
 */
export function scoreCandidate(query: string, candidate: string): number {
  if (!query || !candidate)
    return 0
  const q = query.toLowerCase()
  const c = candidate.toLowerCase()

  if (q === c)
    return 100
  if (c.startsWith(q) || c.endsWith(q))
    return 90
  if (c.includes(q))
    return 80
  if (q.includes(c))
    return 60

  // Levenshtein-based fuzzy score, capped below substring tier
  const raw = similarityRatio(q, c)
  return Math.round(raw * 0.55)
}

/**
 * Options for suggestNodes
 */
export interface SuggestOptions {
  /** Maximum number of suggestions to return (default 5) */
  limit?: number
  /** Restrict suggestions to a subtree by node ID (functional descendants) */
  scope?: string
  /** Minimum score (0-100) for a suggestion to be included (default 30) */
  minScore?: number
}

/**
 * Internal scoring entry
 */
interface ScoredId {
  id: string
  score: number
}

/**
 * Score nodes against a query string.
 * Combines best score of (id, name, feature.description).
 */
export function rankNodes(query: string, nodes: Node[]): ScoredId[] {
  const scored: ScoredId[] = []
  for (const node of nodes) {
    const name = deriveName(node)
    const idScore = scoreCandidate(query, node.id)
    const nameScore = scoreCandidate(query, name)
    const descScore = scoreCandidate(query, node.feature.description)
    const best = Math.max(idScore, nameScore, descScore)
    if (best > 0) {
      scored.push({ id: node.id, score: best })
    }
  }
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  return scored
}

/**
 * Suggest node IDs that closely match a query string.
 *
 * Ordering mirrors the Python `_suggest_dep_nodes` + `_suggest_rpg_nodes`
 * helpers: substring matches on ID and name come first, then fuzzy
 * Levenshtein matches as a fallback.
 *
 * Returns up to `limit` node IDs.
 */
export async function suggestNodes(
  rpg: RepositoryPlanningGraph,
  query: string,
  options: SuggestOptions = {},
): Promise<string[]> {
  const limit = options.limit ?? DEFAULT_SUGGEST_LIMIT
  const minScore = options.minScore ?? 30
  const trimmed = query.trim()
  if (!trimmed)
    return []

  const nodes = await collectCandidateNodes(rpg, options.scope)
  const ranked = rankNodes(trimmed, nodes).filter(entry => entry.score >= minScore)
  return ranked.slice(0, limit).map(entry => entry.id)
}

async function collectCandidateNodes(
  rpg: RepositoryPlanningGraph,
  scope?: string,
): Promise<Node[]> {
  if (!scope) {
    return rpg.getNodes()
  }

  const result: Node[] = []
  const seen = new Set<string>()
  const stack = [scope]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (seen.has(current))
      continue
    seen.add(current)
    const node = await rpg.getNode(current)
    if (!node)
      continue
    result.push(node)
    const children = await rpg.getChildren(current)
    for (const child of children) {
      if (!seen.has(child.id))
        stack.push(child.id)
    }
  }
  return result
}

/**
 * Derive a display-name candidate from a node for scoring purposes.
 */
function deriveName(node: Node): string {
  if (node.metadata?.qualifiedName)
    return node.metadata.qualifiedName
  const nodePath = node.metadata?.path
  if (nodePath) {
    const parts = nodePath.split(path.sep).join('/').split('/').filter(Boolean)
    return parts.at(-1) ?? nodePath
  }
  if ('directoryPath' in node && node.directoryPath) {
    const dirPath = node.directoryPath as string
    const parts = dirPath.split(path.sep).join('/').split('/').filter(Boolean)
    return parts.at(-1) ?? dirPath
  }
  return node.feature.description
}
