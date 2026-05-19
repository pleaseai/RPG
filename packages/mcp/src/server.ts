import type { Embedding } from '@pleaseai/soop-encoder/embedding'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { AISDKEmbedding, HuggingFaceEmbedding } from '@pleaseai/soop-encoder/embedding'
import { SemanticSearch } from '@pleaseai/soop-encoder/semantic-search'
import { RepositoryPlanningGraph } from '@pleaseai/soop-graph'
import { decodeAllEmbeddings, parseEmbeddings, parseEmbeddingsJsonl } from '@pleaseai/soop-graph/embeddings'
import { LocalVectorStore } from '@pleaseai/soop-store/local'
import { createStderrLogger } from '@pleaseai/soop-utils/logger'
import { invalidPathError, RPGError, rpgNotLoadedError } from './errors'
import { InteractiveState, registerInteractiveProtocol } from './interactive'
import { logToolCall } from './telemetry'
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
  SOOP_SERVER_INSTRUCTIONS,
  SOOP_TOOL_ANNOTATIONS,
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
  /**
   * Path to the RPG file on disk. When provided, tool calls will lazily
   * reload the graph from this path if `rpg` is `null` or if the file's
   * mtime has changed — mirrors the Python reference's `engine_box`
   * pattern in `mcp_server.py`, with mtime-based staleness detection
   * so `soop encode` recovers the server without a restart.
   */
  rpgFile?: string
  /** mtime (ms) of the initially loaded graph, used to detect on-disk updates. */
  loadedMtimeMs?: number | null
  /** When true, semantic search is not (re-)initialized on lazy reload. */
  noSearch?: boolean
}

/**
 * Mutable holder for the loaded graph + its file path. Created once per
 * `createMcpServer` call and shared by every tool handler so a successful
 * lazy reload becomes visible to subsequent calls without restarting.
 */
interface ServerState {
  rpg: RepositoryPlanningGraph | null
  rpgFile: string | undefined
  search: SemanticSearch | null
  /** mtime (ms) of the currently loaded graph; `null` when no graph is loaded. */
  loadedMtimeMs: number | null
  /** When true, semantic search is not (re-)initialized on lazy reload. */
  noSearch: boolean
  /**
   * In-flight load promise, used to dedupe concurrent first-call loads.
   * If multiple tool calls hit `requireRpg` before the first load
   * completes, they all await the same promise instead of each triggering
   * a redundant `readFile` + JSON parse.
   */
  loadingPromise: Promise<RepositoryPlanningGraph> | null
  /** Reference to interactive state (if active) so lazy-reload propagates. */
  interactive: InteractiveState | null
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
  const rootPath = options.rootPath

  const state: ServerState = {
    rpg: options.rpg,
    rpgFile: options.rpgFile,
    search: options.semanticSearch ?? semanticSearch ?? null,
    loadedMtimeMs: options.loadedMtimeMs ?? null,
    noSearch: options.noSearch ?? false,
    loadingPromise: null,
    interactive: null,
  }

  const server = new McpServer(
    {
      name: 'soop-mcp-server',
      version: '0.1.0',
    },
    {
      instructions: SOOP_SERVER_INSTRUCTIONS,
    },
  )

  // ------------------------------------------------------------------
  // Tool registrations (migrated to registerTool to attach annotations)
  // ------------------------------------------------------------------

  server.registerTool(
    SOOP_TOOLS.soop_search.name,
    {
      description: SOOP_TOOLS.soop_search.description,
      inputSchema: SearchInputSchema.shape,
      annotations: SOOP_TOOL_ANNOTATIONS.soop_search,
    },
    async (args: unknown) =>
      wrapHandler('soop_search', args, async () => {
        const rpg = await requireRpg(state)
        const input = SearchInputSchema.parse(args)
        const result = await executeSearch(rpg, input, state.search)
        return {
          result,
          summary: { nodes: result.nodes.length, totalMatches: result.totalMatches, mode: result.mode },
        }
      }),
  )

  server.registerTool(
    SOOP_TOOLS.soop_fetch.name,
    {
      description: SOOP_TOOLS.soop_fetch.description,
      inputSchema: FetchInputBaseSchema.shape,
      annotations: SOOP_TOOL_ANNOTATIONS.soop_fetch,
    },
    async (args: unknown) =>
      wrapHandler('soop_fetch', args, async () => {
        const rpg = await requireRpg(state)
        const input = FetchInputSchema.parse(args)
        const result = await executeFetch(rpg, input, { rootPath })
        return {
          result,
          summary: { entities: result.entities.length, notFound: result.notFound.length },
        }
      }),
  )

  server.registerTool(
    SOOP_TOOLS.soop_explore.name,
    {
      description: SOOP_TOOLS.soop_explore.description,
      inputSchema: ExploreInputSchema.shape,
      annotations: SOOP_TOOL_ANNOTATIONS.soop_explore,
    },
    async (args: unknown) =>
      wrapHandler('soop_explore', args, async () => {
        const rpg = await requireRpg(state)
        const input = ExploreInputSchema.parse(args)
        const result = await executeExplore(rpg, input)
        return {
          result,
          summary: {
            nodes: result.nodes.length,
            edges: result.edges.length,
            maxDepthReached: result.maxDepthReached,
          },
        }
      }),
  )

  server.registerTool(
    SOOP_TOOLS.soop_encode.name,
    {
      description: SOOP_TOOLS.soop_encode.description,
      inputSchema: EncodeInputSchema.shape,
      annotations: SOOP_TOOL_ANNOTATIONS.soop_encode,
    },
    async (args: unknown) =>
      wrapHandler('soop_encode', args, async () => {
        const input = EncodeInputSchema.parse(args)
        const result = await executeEncode(input)
        return {
          result,
          summary: {
            filesProcessed: result.filesProcessed,
            entitiesExtracted: result.entitiesExtracted,
            durationMs: result.duration,
          },
        }
      }),
  )

  server.registerTool(
    SOOP_TOOLS.soop_evolve.name,
    {
      description: SOOP_TOOLS.soop_evolve.description,
      inputSchema: EvolveInputSchema.shape,
      annotations: SOOP_TOOL_ANNOTATIONS.soop_evolve,
    },
    async (args: unknown) =>
      wrapHandler('soop_evolve', args, async () => {
        const rpg = await requireRpg(state)
        const input = EvolveInputSchema.parse(args)
        const result = await executeEvolve(rpg, input)
        return { result, summary: { ...result } as Record<string, unknown> }
      }),
  )

  server.registerTool(
    SOOP_TOOLS.soop_stats.name,
    {
      description: SOOP_TOOLS.soop_stats.description,
      inputSchema: StatsInputSchema.shape,
      annotations: SOOP_TOOL_ANNOTATIONS.soop_stats,
    },
    async () =>
      wrapHandler('soop_stats', {}, async () => {
        const rpg = await requireRpg(state)
        const result = await executeStats(rpg)
        return { result, summary: { name: result.name } }
      }),
  )

  // Register interactive encoding protocol when explicitly enabled
  if (options.interactive) {
    const interactiveState = new InteractiveState()
    interactiveState.repoPath = options.rootPath ?? null
    interactiveState.rpg = state.rpg
    state.interactive = interactiveState
    registerInteractiveProtocol(server, interactiveState)
  }

  return server
}

/**
 * Stat a file and return its mtime in milliseconds, or `null` if the file
 * is missing or unreadable. Used by `requireRpg` to detect on-disk updates.
 */
async function getMtimeMs(filePath: string): Promise<number | null> {
  try {
    const s = await stat(filePath)
    return s.mtimeMs
  }
  catch {
    return null
  }
}

/**
 * Lazily resolve the loaded RPG. Reloads when:
 *   1. No graph is cached yet (`state.rpg == null`), or
 *   2. The file on disk has a newer mtime than the cached copy.
 *
 * Concurrent first-callers share a single in-flight load promise via
 * `state.loadingPromise` to avoid redundant file reads + JSON parsing.
 *
 * Throws an enriched `RPGError` with an actionable `nextStep` when no
 * graph can be made available.
 */
async function requireRpg(state: ServerState): Promise<RepositoryPlanningGraph> {
  // If we have a cached graph, check whether the file changed on disk.
  // Skip the stat when no path was configured (the in-memory graph is
  // the only source of truth in that mode).
  //
  // Important: do NOT null `state.rpg` when mtime advances. Keep the
  // last-known-good graph as a fallback so that (a) concurrent callers
  // still see the cached graph while reload is in flight, and (b) a
  // failed reload (partial encode, corrupt rewrite, transient I/O
  // error) doesn't turn into an outage — we serve the stale graph and
  // retry on the next call.
  if (state.rpg && state.rpgFile) {
    const currentMtime = await getMtimeMs(state.rpgFile)
    if (currentMtime !== null && state.loadedMtimeMs !== null && currentMtime <= state.loadedMtimeMs) {
      return state.rpg
    }
    if (currentMtime !== null && state.loadedMtimeMs !== null && currentMtime > state.loadedMtimeMs) {
      log.info(`RPG file mtime changed (${state.loadedMtimeMs} → ${currentMtime}); reloading.`)
      // Fall through to the loadingPromise path; do not null state.rpg.
    }
  }
  else if (state.rpg) {
    return state.rpg
  }

  if (!state.rpgFile) {
    throw rpgNotLoadedError({ reason: 'no_path_configured' })
  }

  // Coalesce concurrent loads on the same in-flight promise.
  if (!state.loadingPromise) {
    const rpgFile = state.rpgFile
    state.loadingPromise = (async () => {
      const loaded = await tryLoadRPG(rpgFile)
      if (!loaded.rpg) {
        // Last-known-good fallback: if we already have a cached graph,
        // keep serving it instead of hard-failing every subsequent tool
        // call. mtime stays at the old value so the next call retries.
        if (state.rpg) {
          log.warn(
            `RPG reload failed (${loaded.errorCode}: ${loaded.errorMessage}); continuing with cached graph.`,
          )
          return state.rpg
        }
        throw rpgNotLoadedError({ rpgFile, reason: loaded.errorCode })
      }
      const mtime = await getMtimeMs(rpgFile)
      state.rpg = loaded.rpg
      state.loadedMtimeMs = mtime
      if (state.interactive) {
        state.interactive.rpg = loaded.rpg
      }
      log.success(`RPG lazy-loaded from ${rpgFile}: ${loaded.rpg.getConfig().name}`)

      // Re-initialize semantic search on lazy reload so `soop_search`
      // recovers vector capability after `soop encode`. Best-effort:
      // failures degrade to string search, never break the load.
      // Clear the old instance first: if reinit throws, we want a clean
      // "no search" state rather than a stale index pointing at the old graph.
      if (!state.noSearch) {
        state.search = null
        try {
          state.search = await initSemanticSearch(loaded.rpg, rpgFile)
        }
        catch (error) {
          log.warn(
            `Semantic search re-init failed after lazy load, continuing without it: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }

      return loaded.rpg
    })()
  }

  try {
    return await state.loadingPromise
  }
  finally {
    // Clear the in-flight promise once it settles so a later mtime-bump
    // can trigger a fresh reload. Both success and failure clear it:
    // a failed load shouldn't trap subsequent callers in the failure.
    state.loadingPromise = null
  }
}

/**
 * Wrap a handler with standard MCP response formatting + telemetry.
 *
 * The inner handler should return `{ result, summary }` so telemetry can
 * record a concise per-tool summary alongside duration. The MCP response
 * payload contains the full `result` (pretty-printed JSON).
 */
async function wrapHandler<T>(
  tool: string,
  params: unknown,
  handler: () => Promise<{ result: T, summary: Record<string, unknown> }>,
): Promise<{ content: Array<{ type: 'text', text: string }>, isError?: true }> {
  const start = Date.now()
  try {
    const { result, summary } = await handler()
    void logToolCall({
      tool,
      params,
      summary,
      durationMs: Date.now() - start,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }
  catch (error) {
    const errorPayload = formatError(error)
    void logToolCall({
      tool,
      params,
      summary: {},
      durationMs: Date.now() - start,
      error: errorPayload.errorMeta,
    })
    return errorPayload.response
  }
}

/**
 * Format an error into the MCP response shape and a concise telemetry summary.
 */
function formatError(error: unknown): {
  response: { content: Array<{ type: 'text', text: string }>, isError: true }
  errorMeta: { code: string, message: string }
} {
  if (error instanceof RPGError) {
    return {
      response: {
        content: [{ type: 'text', text: JSON.stringify(error.toPayload(), null, 2) }],
        isError: true,
      },
      errorMeta: { code: error.code, message: error.message },
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return {
    response: {
      content: [
        { type: 'text', text: JSON.stringify({ error: 'UNKNOWN_ERROR', message }, null, 2) },
      ],
      isError: true,
    },
    errorMeta: { code: 'UNKNOWN_ERROR', message },
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
      ? await RepositoryPlanningGraph.fromJSONLWithMeta(graphJson, metaJson)
      : await RepositoryPlanningGraph.fromJSONL(graphJson)
  }
  return metaJson
    ? await RepositoryPlanningGraph.fromJSONWithMeta(graphJson, metaJson)
    : await RepositoryPlanningGraph.fromJSON(graphJson)
}

/**
 * Non-throwing wrapper around `loadRPG` — returns either the loaded
 * graph or a structured failure code suitable for `rpg_unavailable`
 * payloads. Used by both startup and lazy reload.
 */
export async function tryLoadRPG(
  filePath: string,
): Promise<{ rpg: RepositoryPlanningGraph, errorCode?: undefined } | { rpg: null, errorCode: string, errorMessage: string }> {
  try {
    const rpg = await loadRPG(filePath)
    return { rpg }
  }
  catch (error) {
    if (error instanceof RPGError && error.code === 'INVALID_PATH') {
      // Covers both ENOENT (missing file) and EACCES (permission denied)
      // — both reach loadRPG's catch as `invalidPathError`. Calling it
      // `invalid_path` (rather than the prior `file_not_found`) avoids
      // misclassifying permission-denied loads as missing files.
      return { rpg: null, errorCode: 'invalid_path', errorMessage: error.message }
    }
    return {
      rpg: null,
      errorCode: 'load_failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  }
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
 *
 * IMPORTANT: This function never exits the process on a graph-load failure.
 * Mirrors the Python reference's design (`mcp_server.py:383-398`): the
 * MCP transport must stay up so the client can receive an actionable
 * `rpg_unavailable` payload telling the user to run `soop encode`. Exiting
 * here would surface on the client as the opaque `MCP error -32000:
 * Connection closed`.
 */
export async function startMcpServer(options: StartMcpServerOptions = {}): Promise<void> {
  const { rpgFile, noSearch, interactive, rootPath } = options

  let rpg: RepositoryPlanningGraph | null = null
  let semanticSearch: SemanticSearch | null = null
  let loadedMtimeMs: number | null = null

  if (rpgFile) {
    log.info(`Loading RPG from: ${rpgFile}`)
    const loaded = await tryLoadRPG(rpgFile)
    if (loaded.rpg) {
      rpg = loaded.rpg
      loadedMtimeMs = await getMtimeMs(rpgFile)
      log.success(`RPG loaded: ${rpg.getConfig().name}`)
    }
    else {
      log.warn(
        `Failed to load RPG from ${rpgFile} (${loaded.errorCode}): ${loaded.errorMessage}`,
      )
      log.warn(
        'Server will start in degraded mode. The first tool call will retry the load and, if it still fails, return an actionable rpg_unavailable payload.',
      )
    }

    // Initialize semantic search unless disabled. Skip entirely if the
    // RPG isn't loaded — no nodes to index. (Lazy-reload re-initializes
    // search the first time the graph becomes available.)
    if (rpg && !noSearch) {
      try {
        semanticSearch = await initSemanticSearch(rpg, rpgFile)
      }
      catch (error) {
        log.error(
          `Semantic search initialization failed, continuing without it: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    else if (noSearch) {
      log.info('Semantic search disabled (--no-search)')
    }
  }
  else {
    log.info('No RPG file path provided. Server will start without a pre-loaded RPG.')
    log.info('Usage: soop mcp <rpg-file.json> [--root-path <dir>] [--interactive] [--no-search]')
    log.info(
      'Note: soop_encode tool will still work; other tools will return an actionable rpg_unavailable payload until a graph is provided.',
    )
  }

  if (rootPath) {
    log.info(`Source root path: ${rootPath}`)
  }

  const server = createMcpServer({
    rpg,
    semanticSearch,
    rootPath,
    interactive,
    rpgFile,
    loadedMtimeMs,
    noSearch,
  })
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
