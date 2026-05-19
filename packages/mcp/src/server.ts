import type { Embedding } from '@pleaseai/soop-encoder/embedding'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { AISDKEmbedding, HuggingFaceEmbedding } from '@pleaseai/soop-encoder/embedding'
import { SemanticSearch } from '@pleaseai/soop-encoder/semantic-search'
import { RepositoryPlanningGraph } from '@pleaseai/soop-graph'
import { decodeAllEmbeddings, parseEmbeddings, parseEmbeddingsJsonl } from '@pleaseai/soop-graph/embeddings'
import { LocalVectorStore } from '@pleaseai/soop-store/local'
import { createStderrLogger } from '@pleaseai/soop-utils/logger'
import { invalidPathError, RPGError } from './errors'
import { InteractiveState, registerInteractiveProtocol } from './interactive'
import {
  EncodeInputSchema,
  EvolveInputSchema,
  executeEncode,
  executeEvolve,
  executeExplore,
  executeFetch,
  executeSearch,
  executeStats,
  ExploreInputSchema,
  FetchInputBaseSchema,
  FetchInputSchema,
  SearchInputSchema,
  SOOP_TOOLS,
  StatsInputSchema,
} from './tools'

const log = createStderrLogger('MCP')

export interface McpServerOptions {
  rpg: RepositoryPlanningGraph | null
  semanticSearch?: SemanticSearch | null
  /** Root path override for filesystem source resolution */
  rootPath?: string
  /** Enable interactive encoding protocol */
  interactive?: boolean
}

/**
 * Create and configure the MCP server for RPG tools
 */
export function createMcpServer(
  rpgOrOptions: RepositoryPlanningGraph | null | McpServerOptions,
  semanticSearch?: SemanticSearch | null,
): McpServer {
  // Support both old signature and new options object
  const options: McpServerOptions = rpgOrOptions && typeof rpgOrOptions === 'object' && 'rpg' in rpgOrOptions
    ? rpgOrOptions
    : { rpg: rpgOrOptions as RepositoryPlanningGraph | null, semanticSearch }
  const rpg = options.rpg
  const search = options.semanticSearch ?? semanticSearch ?? null
  const rootPath = options.rootPath
  const server = new McpServer({
    name: 'soop-mcp-server',
    version: '0.1.0',
  })

  // Register all RPG tools
  server.tool(
    SOOP_TOOLS.soop_search.name,
    SOOP_TOOLS.soop_search.description,
    SearchInputSchema.shape,
    async args =>
      wrapHandler(() => executeSearch(rpg, SearchInputSchema.parse(args), search)),
  )

  server.tool(
    SOOP_TOOLS.soop_fetch.name,
    SOOP_TOOLS.soop_fetch.description,
    FetchInputBaseSchema.shape,
    async (args: unknown) => wrapHandler(() => executeFetch(rpg, FetchInputSchema.parse(args), { rootPath })),
  )

  server.tool(
    SOOP_TOOLS.soop_explore.name,
    SOOP_TOOLS.soop_explore.description,
    ExploreInputSchema.shape,
    async args => wrapHandler(() => executeExplore(rpg, ExploreInputSchema.parse(args))),
  )

  server.tool(
    SOOP_TOOLS.soop_encode.name,
    SOOP_TOOLS.soop_encode.description,
    EncodeInputSchema.shape,
    async args => wrapHandler(() => executeEncode(EncodeInputSchema.parse(args))),
  )

  server.tool(
    SOOP_TOOLS.soop_evolve.name,
    SOOP_TOOLS.soop_evolve.description,
    EvolveInputSchema.shape,
    async args => wrapHandler(() => executeEvolve(rpg, EvolveInputSchema.parse(args))),
  )

  server.tool(
    SOOP_TOOLS.soop_stats.name,
    SOOP_TOOLS.soop_stats.description,
    StatsInputSchema.shape,
    async () => wrapHandler(() => executeStats(rpg)),
  )

  // Register interactive encoding protocol when explicitly enabled
  if (options.interactive) {
    const state = new InteractiveState()
    state.repoPath = options.rootPath ?? null
    state.rpg = rpg
    registerInteractiveProtocol(server, state)
  }

  return server
}

/**
 * Wrap a handler function with standard MCP response formatting
 */
async function wrapHandler<T>(
  handler: () => T | Promise<T>,
): Promise<{ content: Array<{ type: 'text', text: string }>, isError?: true }> {
  try {
    const result = await handler()
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
  catch (error) {
    return formatError(error)
  }
}

/**
 * Format error for MCP response
 */
function formatError(error: unknown): {
  content: Array<{ type: 'text', text: string }>
  isError: true
} {
  if (error instanceof RPGError) {
    return {
      content: [
        { type: 'text', text: JSON.stringify({ error: error.code, message: error.message }) },
      ],
      isError: true,
    }
  }
  if (error instanceof Error) {
    return {
      content: [
        { type: 'text', text: JSON.stringify({ error: 'UNKNOWN_ERROR', message: error.message }) },
      ],
      isError: true,
    }
  }
  return {
    content: [
      { type: 'text', text: JSON.stringify({ error: 'UNKNOWN_ERROR', message: String(error) }) },
    ],
    isError: true,
  }
}

/**
 * Load RPG from file path (reads companion .meta.json if present)
 */
export async function loadRPG(filePath: string): Promise<RepositoryPlanningGraph> {
  let graphJson: string
  try {
    graphJson = await readFile(filePath, 'utf-8')
  }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'EACCES') {
      throw invalidPathError(filePath)
    }
    throw error
  }

  let metaJson: string | undefined
  try {
    const { metaPathFor } = await import('@pleaseai/soop-graph/meta')
    metaJson = await readFile(metaPathFor(filePath), 'utf-8')
  }
  catch (metaError) {
    const code = (metaError as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      log.warn(`Could not read meta file for ${filePath}: ${metaError instanceof Error ? metaError.message : String(metaError)}`)
    }
    // meta file is optional
  }

  const isJsonl = filePath.endsWith('.jsonl')
  if (isJsonl) {
    return metaJson
      ? await RepositoryPlanningGraph.fromJSONLWithMeta(graphJson, metaJson, undefined, filePath)
      : await RepositoryPlanningGraph.fromJSONL(graphJson)
  }
  return metaJson
    ? await RepositoryPlanningGraph.fromJSONWithMeta(graphJson, metaJson, undefined, filePath)
    : await RepositoryPlanningGraph.fromJSON(graphJson)
}

export interface StartMcpServerOptions {
  rpgFile?: string
  noSearch?: boolean
  interactive?: boolean
  rootPath?: string
}

/**
 * Start the MCP server with parsed options.
 * Called by the `soop mcp` subcommand or directly from `main()`.
 */
export async function startMcpServer(options: StartMcpServerOptions = {}): Promise<void> {
  const { rpgFile, noSearch, interactive, rootPath } = options

  let rpg: RepositoryPlanningGraph | null = null
  let semanticSearch: SemanticSearch | null = null

  if (rpgFile) {
    try {
      log.info(`Loading RPG from: ${rpgFile}`)
      rpg = await loadRPG(rpgFile)
      log.success(`RPG loaded: ${rpg.getConfig().name}`)
    }
    catch (error) {
      log.fatal(`Failed to load RPG: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }

    // Initialize semantic search unless disabled
    if (!noSearch) {
      try {
        semanticSearch = await initSemanticSearch(rpg, rpgFile)
      }
      catch (error) {
        log.error(
          `Semantic search initialization failed, continuing without it: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    else {
      log.info('Semantic search disabled (--no-search)')
    }
  }
  else {
    log.info('No RPG file path provided. Server will start without a pre-loaded RPG.')
    log.info('Usage: soop mcp <rpg-file.json> [--root-path <dir>] [--interactive] [--no-search]')
    log.info(
      'Note: rpg_encode tool will still work, but other tools require an RPG to be loaded.',
    )
  }

  if (rootPath) {
    log.info(`Source root path: ${rootPath}`)
  }

  const server = createMcpServer({ rpg, semanticSearch, rootPath, interactive })
  const transport = new StdioServerTransport()

  await server.connect(transport)
  log.ready('RPG MCP server started')
}

/**
 * Main entry point for the MCP server (argv parsing wrapper).
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const noSearch = args.includes('--no-search')
  const interactive = args.includes('--interactive')

  // Parse --root-path <dir>
  let rootPath: string | undefined
  const rootPathIdx = args.indexOf('--root-path')
  if (rootPathIdx !== -1 && rootPathIdx + 1 < args.length) {
    rootPath = args[rootPathIdx + 1]
  }

  const filteredArgs = args.filter((a, i) =>
    a !== '--no-search'
    && a !== '--interactive'
    && a !== '--root-path'
    && (rootPathIdx === -1 || i !== rootPathIdx + 1),
  )

  await startMcpServer({
    rpgFile: filteredArgs[0],
    noSearch,
    interactive,
    rootPath,
  })
}

/**
 * Initialize semantic search with HuggingFace embedding and index RPG nodes.
 *
 * If `.soop/embeddings.json` exists alongside the RPG file, pre-computed
 * embeddings are loaded directly into LanceDB, skipping HuggingFace model loading.
 */
async function initSemanticSearch(
  rpg: RepositoryPlanningGraph,
  rpgPath: string,
): Promise<SemanticSearch> {
  const dbPath = join(dirname(rpgPath), `${basename(rpgPath)}.vectors`)

  // Check for pre-computed embeddings (.jsonl preferred, .json as fallback)
  const embeddingsPathJsonl = join(dirname(rpgPath), 'embeddings.jsonl')
  const embeddingsPathJson = join(dirname(rpgPath), 'embeddings.json')
  const embeddingsPath = existsSync(embeddingsPathJsonl) ? embeddingsPathJsonl : embeddingsPathJson
  if (existsSync(embeddingsPath)) {
    try {
      return await initFromPrecomputedEmbeddings(rpg, rpgPath, embeddingsPath, dbPath)
    }
    catch (error) {
      log.warn(
        `Failed to load pre-computed embeddings: ${error instanceof Error ? error.message : String(error)}`,
      )
      log.warn('Falling back to HuggingFace embedding')
    }
  }

  const embedding = new HuggingFaceEmbedding({
    model: 'MongoDB/mdbr-leaf-ir',
    dtype: 'q8',
  })

  const vectorStore = new LocalVectorStore()
  await vectorStore.open({ path: dbPath })
  const semanticSearch = new SemanticSearch({ vectorStore, embedding })

  // Skip indexing if vector DB already exists (check for the actual data file)
  const existingCount = existsSync(join(dbPath, 'vectors.json')) ? await semanticSearch.count() : 0
  if (existingCount > 0) {
    log.success(`Semantic search ready (${existingCount} nodes already indexed)`)
  }
  else {
    // Index all RPG nodes
    const nodes = await rpg.getNodes()
    log.start(`Indexing ${nodes.length} nodes for semantic search...`)

    const documents = nodes.map(node => ({
      id: node.id,
      content: `${node.feature.description} ${(node.feature.keywords ?? []).join(' ')} ${node.metadata?.path ?? ''}`,
      metadata: {
        entityType: node.metadata?.entityType,
        path: node.metadata?.path,
      },
    }))

    await semanticSearch.indexBatch(documents)
    log.success(`Semantic search ready (${documents.length} nodes indexed)`)
  }

  return semanticSearch
}

/**
 * Create an embedding provider for search queries, based on the config stored in embeddings.json.
 *
 * For `transformers` provider, uses HuggingFaceEmbedding with the stored model.
 * For `voyage-ai`, prefers a real Voyage AI call (if VOYAGE_API_KEY is set) then falls back
 * to local voyage-4-nano, which shares the same embedding space per CLAUDE.md.
 * For `openai`, uses the OpenAI API if OPENAI_API_KEY is set.
 * All other providers fall back to local voyage-4-nano with a warning.
 */
async function createEmbeddingForSearch(config: {
  provider: string
  model: string
  dimension: number
  space?: string
}): Promise<Embedding> {
  const HFEmbedding = HuggingFaceEmbedding

  if (config.provider === 'transformers') {
    return new HFEmbedding({ model: config.model })
  }

  if (config.provider === 'voyage-ai' || config.space?.startsWith('voyage')) {
    const apiKey = process.env.VOYAGE_API_KEY
    if (apiKey) {
      const { createOpenAI } = await import('@ai-sdk/openai')
      const voyageProvider = createOpenAI({ apiKey, baseURL: 'https://api.voyageai.com/v1' })
      return new AISDKEmbedding({
        model: voyageProvider.embedding(config.model),
        dimension: config.dimension,
        providerName: 'VoyageAI',
      })
    }
    log.info('VOYAGE_API_KEY not set — using local voyage-4-nano for query embedding (compatible embedding space)')
    return new HFEmbedding({ model: 'voyageai/voyage-4-nano' })
  }

  if (config.provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY
    if (apiKey) {
      const { createOpenAI } = await import('@ai-sdk/openai')
      const openaiProvider = createOpenAI({ apiKey })
      return new AISDKEmbedding({
        model: openaiProvider.embedding(config.model),
        dimension: config.dimension,
        providerName: 'OpenAI',
      })
    }
    log.warn('OPENAI_API_KEY not set — falling back to local voyage-4-nano (different embedding space, search quality may be degraded)')
  }
  else {
    log.warn(`Unsupported embedding provider "${config.provider}" — falling back to local voyage-4-nano`)
  }

  return new HFEmbedding({ model: 'voyageai/voyage-4-nano' })
}

/**
 * Initialize semantic search from pre-computed embeddings.json.
 * Loads float16 vectors into LanceDB without HuggingFace model loading.
 */
async function initFromPrecomputedEmbeddings(
  rpg: RepositoryPlanningGraph,
  _rpgPath: string,
  embeddingsPath: string,
  dbPath: string,
): Promise<SemanticSearch> {
  log.start('Loading pre-computed embeddings...')
  const embeddingsContent = await readFile(embeddingsPath, 'utf-8')
  const embeddingsData = embeddingsPath.endsWith('.jsonl')
    ? parseEmbeddingsJsonl(embeddingsContent)
    : parseEmbeddings(embeddingsContent)
  const vectors = decodeAllEmbeddings(embeddingsData)

  // Create a real embedding provider for query-time use.
  // This must produce vectors in the same space as the pre-computed document embeddings.
  const queryEmbedding = await createEmbeddingForSearch(embeddingsData.config)

  const vectorStore = new LocalVectorStore()
  await vectorStore.open({ path: dbPath })

  const semanticSearch = new SemanticSearch({
    vectorStore,
    embedding: queryEmbedding,
  })

  // Build documents with pre-computed vectors
  const nodes = await rpg.getNodes()
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  const docs = [...vectors.entries()]
    .filter(([id]) => nodeMap.has(id))
    .map(([id, vector]) => {
      const node = nodeMap.get(id)!
      return {
        id,
        embedding: vector,
        metadata: {
          text: `${node.feature.description} ${(node.feature.keywords ?? []).join(' ')} ${node.metadata?.path ?? ''}`,
          entityType: node.metadata?.entityType,
          path: node.metadata?.path,
        },
      }
    })

  if (docs.length > 0) {
    await vectorStore.upsertBatch(docs)
  }

  log.success(
    `Pre-computed embeddings loaded: ${docs.length} vectors (${embeddingsData.config.provider}/${embeddingsData.config.model})`,
  )

  return semanticSearch
}

// Run if executed directly
if (import.meta.main) {
  main().catch((error) => {
    log.fatal('Fatal error:', error)
    process.exit(1)
  })
}
