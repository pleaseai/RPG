import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { HuggingFaceEmbedding } from '@pleaseai/rpg-encoder/embedding'
import { SemanticSearch } from '@pleaseai/rpg-encoder/semantic-search'
import { RepositoryPlanningGraph } from '@pleaseai/rpg-graph'
import { LocalVectorStore } from '@pleaseai/rpg-store/local'
import { createStderrLogger } from '@pleaseai/rpg-utils/logger'
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
  RPG_TOOLS,
  SearchInputSchema,
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
    name: 'rpg-mcp-server',
    version: '0.1.0',
  })

  // Register all RPG tools
  server.tool(
    RPG_TOOLS.rpg_search.name,
    RPG_TOOLS.rpg_search.description,
    SearchInputSchema.shape,
    async args =>
      wrapHandler(() => executeSearch(rpg, SearchInputSchema.parse(args), search)),
  )

  server.tool(
    RPG_TOOLS.rpg_fetch.name,
    RPG_TOOLS.rpg_fetch.description,
    FetchInputBaseSchema.shape,
    async (args: unknown) => wrapHandler(() => executeFetch(rpg, FetchInputSchema.parse(args), { rootPath })),
  )

  server.tool(
    RPG_TOOLS.rpg_explore.name,
    RPG_TOOLS.rpg_explore.description,
    ExploreInputSchema.shape,
    async args => wrapHandler(() => executeExplore(rpg, ExploreInputSchema.parse(args))),
  )

  server.tool(
    RPG_TOOLS.rpg_encode.name,
    RPG_TOOLS.rpg_encode.description,
    EncodeInputSchema.shape,
    async args => wrapHandler(() => executeEncode(EncodeInputSchema.parse(args))),
  )

  server.tool(
    RPG_TOOLS.rpg_evolve.name,
    RPG_TOOLS.rpg_evolve.description,
    EvolveInputSchema.shape,
    async args => wrapHandler(() => executeEvolve(rpg, EvolveInputSchema.parse(args))),
  )

  server.tool(
    RPG_TOOLS.rpg_stats.name,
    RPG_TOOLS.rpg_stats.description,
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
 * Load RPG from file path
 */
export async function loadRPG(filePath: string): Promise<RepositoryPlanningGraph> {
  try {
    const content = await readFile(filePath, 'utf-8')
    return await RepositoryPlanningGraph.fromJSON(content)
  }
  catch {
    throw invalidPathError(filePath)
  }
}

/**
 * Main entry point for the MCP server
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

  let rpg: RepositoryPlanningGraph | null = null
  let semanticSearch: SemanticSearch | null = null

  const rpgPath = filteredArgs[0]
  if (rpgPath) {
    try {
      log.info(`Loading RPG from: ${rpgPath}`)
      rpg = await loadRPG(rpgPath)
      log.success(`RPG loaded: ${rpg.getConfig().name}`)
    }
    catch (error) {
      log.fatal(`Failed to load RPG: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }

    // Initialize semantic search unless disabled
    if (!noSearch) {
      try {
        semanticSearch = await initSemanticSearch(rpg, rpgPath)
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
    log.info('Usage: bun run src/mcp/server.ts <rpg-file.json> [--root-path <dir>] [--interactive] [--no-search]')
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
 * Initialize semantic search with HuggingFace embedding and index RPG nodes
 */
async function initSemanticSearch(
  rpg: RepositoryPlanningGraph,
  rpgPath: string,
): Promise<SemanticSearch> {
  const dbPath = join(dirname(rpgPath), `${rpgPath}.vectors`)

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

// Run if executed directly
if (import.meta.main) {
  main().catch((error) => {
    log.fatal('Fatal error:', error)
    process.exit(1)
  })
}
