import type { SemanticSearch } from '../encoder/semantic-search'
import type { RepositoryPlanningGraph } from '../graph'
import type { ExploreEdgeType } from '../tools/explore'
import type { FetchNodeConfig } from '../tools/fetch'
import type { SearchMode, SearchStrategy } from '../tools/search'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { RPGEncoder } from '../encoder/encoder'
import { RPGEvolver } from '../encoder/evolution/evolve'
import { ExploreRPG } from '../tools/explore'
import { FetchNode } from '../tools/fetch'
import { SearchNode } from '../tools/search'
import { encodeFailedError, evolveFailedError, invalidInputError, invalidPathError, nodeNotFoundError, RPGError, rpgNotLoadedError } from './errors'

/**
 * Input schema for rpg_search tool
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
 * Base schema for rpg_fetch tool (used for MCP shape)
 */
export const FetchInputBaseSchema = z.object({
  codeEntities: z.array(z.string()).optional(),
  featureEntities: z.array(z.string()).optional(),
})

/**
 * Input schema for rpg_fetch tool with validation
 */
export const FetchInputSchema = FetchInputBaseSchema.refine(
  data => (data.codeEntities?.length ?? 0) > 0 || (data.featureEntities?.length ?? 0) > 0,
  {
    message: 'At least one of codeEntities or featureEntities must be provided',
  },
)

export type FetchInput = z.infer<typeof FetchInputSchema>

/**
 * Input schema for rpg_explore tool
 */
export const ExploreInputSchema = z.object({
  startNode: z.string(),
  edgeType: z.enum(['containment', 'dependency', 'all']).default('all'),
  maxDepth: z.number().default(3),
  direction: z.enum(['downstream', 'upstream', 'both']).default('downstream'),
})

export type ExploreInput = z.infer<typeof ExploreInputSchema>

/**
 * Input schema for rpg_encode tool
 */
export const EncodeInputSchema = z.object({
  repoPath: z.string().describe('Repository path to encode'),
  includeSource: z.boolean().default(false),
  respectGitignore: z.boolean().default(true).describe('Respect .gitignore rules via git ls-files'),
  outputPath: z.string().optional(),
})

export type EncodeInput = z.infer<typeof EncodeInputSchema>

/**
 * Input schema for rpg_evolve tool
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
 * Input schema for rpg_stats tool (no input required)
 */
export const StatsInputSchema = z.object({})

export type StatsInput = z.infer<typeof StatsInputSchema>

/**
 * MCP tool definitions for RPG operations
 */
export const RPG_TOOLS = {
  rpg_search: {
    name: 'rpg_search',
    description:
      'Semantic code search using Repository Planning Graph. Search by features (behavioral descriptions) or snippets (file patterns). In auto mode, uses staged fallback: feature search runs first, snippet search only triggers when feature results are empty. Use searchScopes to restrict search to specific subtrees.',
    inputSchema: SearchInputSchema,
  },
  rpg_fetch: {
    name: 'rpg_fetch',
    description:
      'Retrieve precise metadata and source context for code entities. Returns node details, source code, and feature paths.',
    inputSchema: FetchInputSchema,
  },
  rpg_explore: {
    name: 'rpg_explore',
    description:
      'Traverse the Repository Planning Graph to discover related modules. Navigate along containment (hierarchy) and dependency (import/call) edges in upstream or downstream direction.',
    inputSchema: ExploreInputSchema,
  },
  rpg_encode: {
    name: 'rpg_encode',
    description:
      'Encode a repository into a Repository Planning Graph. Extracts semantic features, builds functional hierarchy, and identifies dependencies.',
    inputSchema: EncodeInputSchema,
  },
  rpg_evolve: {
    name: 'rpg_evolve',
    description:
      'Incrementally update the loaded RPG from git commits. Parses the diff, then deletes removed entities, modifies changed entities (with semantic drift detection), and inserts new entities.',
    inputSchema: EvolveInputSchema,
  },
  rpg_stats: {
    name: 'rpg_stats',
    description:
      'Get statistics about the loaded Repository Planning Graph including node counts, edge counts, and structural breakdown.',
    inputSchema: StatsInputSchema,
  },
} as const

/**
 * Execute rpg_search tool
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
 * Execute rpg_fetch tool
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
 * Execute rpg_explore tool
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
 * Execute rpg_encode tool
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
      await writeFile(input.outputPath, await result.rpg.toJSON())
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
 * Execute rpg_evolve tool
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
      await writeFile(input.outputPath, await rpg.toJSON())
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
 * Execute rpg_stats tool
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
