import type { SemanticSearch } from '@pleaseai/soop-encoder/semantic-search'
import type { RepositoryPlanningGraph } from '@pleaseai/soop-graph'
import type { ExploreEdgeType } from '@pleaseai/soop-tools/explore'
import type { FetchNodeConfig } from '@pleaseai/soop-tools/fetch'
import type { SearchMode, SearchStrategy } from '@pleaseai/soop-tools/search'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { RPGEncoder } from '@pleaseai/soop-encoder/encoder'
import { RPGEvolver } from '@pleaseai/soop-encoder/evolution/evolve'
import { ExploreRPG } from '@pleaseai/soop-tools/explore'
import { FetchNode } from '@pleaseai/soop-tools/fetch'
import { SearchNode } from '@pleaseai/soop-tools/search'
import { z } from 'zod/v4'
import { encodeFailedError, evolveFailedError, invalidInputError, invalidPathError, nodeNotFoundError, RPGError, rpgNotLoadedError } from './errors'

/**
 * Input schema for soop_search tool
 */
export const SearchInputSchema = z.object({
  mode: z.enum(['features', 'snippets', 'auto']).default('auto'),
  featureTerms: z.array(z.string()).optional(),
  filePattern: z.string().optional(),
  searchScopes: z.array(z.string()).optional().describe('Feature node IDs to restrict search to their subtrees'),
  searchStrategy: z
    .enum(['hybrid', 'vector', 'fts', 'string'])
    .optional()
    .describe(
      'Search strategy for feature search. Defaults to hybrid when semantic search is available.',
    ),
})

export type SearchInput = z.infer<typeof SearchInputSchema>

/**
 * Base schema for soop_fetch tool (used for MCP shape)
 */
export const FetchInputBaseSchema = z.object({
  codeEntities: z.array(z.string()).optional(),
  featureEntities: z.array(z.string()).optional(),
})

/**
 * Input schema for soop_fetch tool with validation
 */
export const FetchInputSchema = FetchInputBaseSchema.refine(
  data => (data.codeEntities?.length ?? 0) > 0 || (data.featureEntities?.length ?? 0) > 0,
  {
    message: 'At least one of codeEntities or featureEntities must be provided',
  },
)

export type FetchInput = z.infer<typeof FetchInputSchema>

/**
 * Input schema for soop_explore tool
 */
export const ExploreInputSchema = z.object({
  startNode: z.string(),
  edgeType: z.enum(['containment', 'dependency', 'data_flow', 'all']).default('all'),
  maxDepth: z.number().default(3),
  direction: z.enum(['downstream', 'upstream', 'both']).default('downstream'),
  dependencyType: z.enum(['import', 'call', 'inherit', 'implement', 'use']).optional().describe('Filter dependency edges by their dependency type'),
})

export type ExploreInput = z.infer<typeof ExploreInputSchema>

/**
 * Input schema for soop_encode tool
 */
export const EncodeInputSchema = z.object({
  repoPath: z.string().describe('Repository path to encode'),
  includeSource: z.boolean().default(false),
  respectGitignore: z.boolean().default(true).describe('Respect .gitignore rules via git ls-files'),
  outputPath: z.string().optional(),
})

export type EncodeInput = z.infer<typeof EncodeInputSchema>

/**
 * Input schema for soop_evolve tool
 */
export const EvolveInputSchema = z.object({
  commitRange: z.string().describe('Git commit range (e.g., "HEAD~1..HEAD")'),
  driftThreshold: z.number().min(0).max(1).optional().describe('Cosine distance threshold for semantic drift (default 0.3)'),
  useLLM: z.boolean().optional().describe('Use LLM for semantic routing (default true)'),
  includeSource: z.boolean().optional().describe('Include source code in new/modified nodes'),
  outputPath: z.string().optional().describe('Save updated RPG to this path'),
})

export type EvolveInput = z.infer<typeof EvolveInputSchema>

/**
 * Input schema for soop_stats tool (no input required)
 */
export const StatsInputSchema = z.object({})

export type StatsInput = z.infer<typeof StatsInputSchema>

/**
 * Server-level instructions surfaced via MCP `initialize` so the agent
 * understands what the RPG graph knows about this repository and which
 * tool answers which kind of question.
 *
 * Adapted from the Python reference's `FastMCP(instructions=...)` block at
 * `vendor/RPG-ZeroRepo/RPG-Kit/scripts/mcp_server.py`, but tailored to
 * the actual TypeScript tool surface (search/fetch/explore/encode/evolve/stats).
 */
export const SOOP_SERVER_INSTRUCTIONS = [
  'This server provides structured access to the Repository Planning Graph (RPG) for the current workspace — a pre-computed, queryable index of the codebase built by `soop encode` and kept in sync by `soop evolve`.',
  '',
  'What the RPG knows about this repository:',
  '  • The feature hierarchy: high-level functional areas → individual features → the source entities that implement them.',
  '  • Every code entity: files, classes, and functions with their signatures, line ranges, and (optionally) source code.',
  '  • Resolved dependency edges between entities: imports, calls, inherits, implements, uses; plus containment (parent ↔ child) and data-flow edges.',
  '',
  'What you can ask it for (and which tool answers it):',
  '  • The definition site of any symbol (function, class, file) by name, behavior, or feature term. → `soop_search`',
  '  • Full metadata and source code for one or more entities, with their feature paths in the hierarchy. → `soop_fetch`',
  '  • The callers/callees, parents/children, or full reachable subgraph from a starting node. → `soop_explore`',
  '  • An overview of how the graph is shaped — node/edge counts, structural breakdown. → `soop_stats`',
  '  • Building or refreshing the RPG for a repository on disk. → `soop_encode` (cold build), `soop_evolve` (incremental from a git commit range).',
  '',
  'Tool selection heuristics:',
  '  • Start with `soop_search` (mode "auto") for any "where is X?" or "which code does Y?" question.',
  '  • Use `soop_fetch` after `soop_search` to read the actual signature/source of returned node IDs.',
  '  • Use `soop_explore` when you need to follow imports/calls or walk the feature tree.',
  '  • These resolve references semantically and aggregate by feature — far more direct than text search for structural questions.',
  '',
  'Error handling:',
  '  • If a tool returns `error: "RPG_NOT_LOADED"`, the graph has not been built yet. Relay the `nextStep` field verbatim to the user — do not retry.',
].join('\n')

/**
 * MCP tool annotations — declared alongside `SOOP_TOOLS` so the
 * server can pass them through `registerTool(..., { annotations })`.
 *
 * `readOnlyHint: true` for tools that only query the loaded graph.
 * `destructiveHint: false` and `openWorldHint: true` for tools that
 * touch the filesystem / external git state.
 */
export const SOOP_TOOL_ANNOTATIONS = {
  soop_search: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  soop_fetch: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  soop_explore: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  soop_stats: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  soop_encode: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
  soop_evolve: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
} as const

/**
 * MCP tool definitions for RPG operations
 */
export const SOOP_TOOLS = {
  soop_search: {
    name: 'soop_search',
    description:
      'Semantic code search using Repository Planning Graph. Search by features (behavioral descriptions) or snippets (file patterns). In auto mode, uses staged fallback: feature search runs first, snippet search only triggers when feature results are empty. Use searchScopes to restrict search to specific subtrees.',
    inputSchema: SearchInputSchema,
  },
  soop_fetch: {
    name: 'soop_fetch',
    description:
      'Retrieve precise metadata and source context for code entities. Returns node details, source code, and feature paths.',
    inputSchema: FetchInputSchema,
  },
  soop_explore: {
    name: 'soop_explore',
    description:
      'Traverse the Repository Planning Graph to discover related modules. Navigate along containment (hierarchy) and dependency (import/call) edges in upstream or downstream direction.',
    inputSchema: ExploreInputSchema,
  },
  soop_encode: {
    name: 'soop_encode',
    description:
      'Encode a repository into a Repository Planning Graph. Extracts semantic features, builds functional hierarchy, and identifies dependencies.',
    inputSchema: EncodeInputSchema,
  },
  soop_evolve: {
    name: 'soop_evolve',
    description:
      'Incrementally update the loaded RPG from git commits. Parses the diff, then deletes removed entities, modifies changed entities (with semantic drift detection), and inserts new entities.',
    inputSchema: EvolveInputSchema,
  },
  soop_stats: {
    name: 'soop_stats',
    description:
      'Get statistics about the loaded Repository Planning Graph including node counts, edge counts, and structural breakdown.',
    inputSchema: StatsInputSchema,
  },
} as const

/**
 * Execute soop_search tool
 */
export async function executeSearch(
  rpg: RepositoryPlanningGraph | null,
  input: SearchInput,
  semanticSearch?: SemanticSearch | null,
) {
  if (!rpg) {
    throw rpgNotLoadedError()
  }

  const searchNode = new SearchNode(rpg, semanticSearch)
  const result = await searchNode.query({
    mode: input.mode as SearchMode,
    featureTerms: input.featureTerms,
    filePattern: input.filePattern,
    searchScopes: input.searchScopes,
    searchStrategy: input.searchStrategy as SearchStrategy | undefined,
  })

  return {
    nodes: result.nodes.map(node => ({
      id: node.id,
      type: node.type,
      feature: node.feature,
      metadata: node.metadata,
    })),
    totalMatches: result.totalMatches,
    mode: result.mode,
  }
}

/**
 * Execute soop_fetch tool
 */
export async function executeFetch(rpg: RepositoryPlanningGraph | null, input: FetchInput, config?: FetchNodeConfig) {
  if (!rpg) {
    throw rpgNotLoadedError()
  }

  const fetchNode = new FetchNode(rpg, config)
  const result = await fetchNode.get({
    codeEntities: input.codeEntities,
    featureEntities: input.featureEntities,
  })

  return {
    entities: result.entities.map(entity => ({
      node: {
        id: entity.node.id,
        type: entity.node.type,
        feature: entity.node.feature,
        metadata: entity.node.metadata,
      },
      sourceCode: entity.sourceCode,
      featurePaths: entity.featurePaths,
    })),
    notFound: result.notFound,
  }
}

/**
 * Execute soop_explore tool
 */
export async function executeExplore(rpg: RepositoryPlanningGraph | null, input: ExploreInput) {
  if (!rpg) {
    throw rpgNotLoadedError()
  }

  const startNodeExists = await rpg.hasNode(input.startNode)
  if (!startNodeExists) {
    throw nodeNotFoundError(input.startNode)
  }

  const explorer = new ExploreRPG(rpg)
  const result = await explorer.traverse({
    startNode: input.startNode,
    edgeType: input.edgeType as ExploreEdgeType,
    maxDepth: input.maxDepth,
    direction: input.direction,
    dependencyType: input.dependencyType,
  })

  return {
    nodes: result.nodes.map(node => ({
      id: node.id,
      type: node.type,
      feature: node.feature,
      metadata: node.metadata,
    })),
    edges: result.edges,
    maxDepthReached: result.maxDepthReached,
  }
}

/**
 * Execute soop_encode tool
 */
export async function executeEncode(input: EncodeInput) {
  try {
    const encoder = new RPGEncoder(input.repoPath, {
      includeSource: input.includeSource,
      respectGitignore: input.respectGitignore,
    })

    const result = await encoder.encode()

    let rpgPath: string | undefined
    if (input.outputPath) {
      await encoder.save(input.outputPath)
      rpgPath = input.outputPath
    }

    return {
      success: true,
      filesProcessed: result.filesProcessed,
      entitiesExtracted: result.entitiesExtracted,
      duration: result.duration,
      rpgPath,
    }
  }
  catch (error) {
    throw encodeFailedError(error instanceof Error ? error.message : String(error))
  }
}

/**
 * Execute soop_evolve tool
 */
export async function executeEvolve(rpg: RepositoryPlanningGraph | null, input: EvolveInput) {
  if (!rpg) {
    throw rpgNotLoadedError()
  }

  const config = rpg.getConfig()
  const rootPath = config.rootPath
  if (!rootPath) {
    throw invalidInputError('RPG config is missing rootPath — cannot determine repository location')
  }

  if (!existsSync(rootPath)) {
    throw invalidPathError(rootPath)
  }

  if (input.outputPath) {
    const parentDir = dirname(input.outputPath)
    if (!existsSync(parentDir)) {
      throw invalidPathError(`Output directory does not exist: ${parentDir}`)
    }
  }

  try {
    const evolver = new RPGEvolver(rpg, {
      commitRange: input.commitRange,
      repoPath: rootPath,
      driftThreshold: input.driftThreshold,
      useLLM: input.useLLM,
      includeSource: input.includeSource,
    })

    const result = await evolver.evolve()

    if (input.outputPath) {
      const { metaPathFor } = await import('@pleaseai/soop-graph/meta')
      const { graphJson, metaJson } = await rpg.toJSONWithMeta(input.outputPath)
      await writeFile(input.outputPath, graphJson)
      await writeFile(metaPathFor(input.outputPath), metaJson)
    }

    return result
  }
  catch (error) {
    if (error instanceof RPGError) {
      throw error
    }
    throw evolveFailedError(error instanceof Error ? error.message : String(error))
  }
}

/**
 * Execute soop_stats tool
 */
export async function executeStats(rpg: RepositoryPlanningGraph | null) {
  if (!rpg) {
    throw rpgNotLoadedError()
  }

  const stats = await rpg.getStats()
  const config = rpg.getConfig()

  return {
    name: config.name,
    ...stats,
  }
}
