import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { HuggingFaceEmbedding } from '../encoder/embedding'
import { SemanticSearch } from '../encoder/semantic-search'
import { RepositoryPlanningGraph } from '../graph'
import { invalidPathError, RPGError } from './errors'
import {
  EncodeInputSchema,
  executeEncode,
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

/**
 * Create and configure the MCP server for RPG tools
 */
export function createMcpServer(
  rpg: RepositoryPlanningGraph | null,
  semanticSearch?: SemanticSearch | null,
): McpServer {
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
      wrapHandler(() => executeSearch(rpg, SearchInputSchema.parse(args), semanticSearch)),
  )

  server.tool(
    RPG_TOOLS.rpg_fetch.name,
    RPG_TOOLS.rpg_fetch.description,
    FetchInputBaseSchema.shape,
    async (args: unknown) => wrapHandler(() => executeFetch(rpg, FetchInputSchema.parse(args))),
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
    RPG_TOOLS.rpg_stats.name,
    RPG_TOOLS.rpg_stats.description,
    StatsInputSchema.shape,
    async () => wrapHandler(() => executeStats(rpg)),
  )

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
  const filteredArgs = args.filter(a => a !== '--no-search')

  let rpg: RepositoryPlanningGraph | null = null
  let semanticSearch: SemanticSearch | null = null

  const rpgPath = filteredArgs[0]
  if (rpgPath) {
    try {
      console.error(`Loading RPG from: ${rpgPath}`)
      rpg = await loadRPG(rpgPath)
      console.error(`RPG loaded: ${rpg.getConfig().name}`)
    }
    catch (error) {
      console.error(`Failed to load RPG: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }

    // Initialize semantic search unless disabled
    if (!noSearch) {
      try {
        semanticSearch = await initSemanticSearch(rpg, rpgPath)
      }
      catch (error) {
        console.error(
          `Semantic search initialization failed, continuing without it: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    else {
      console.error('Semantic search disabled (--no-search)')
    }
  }
  else {
    console.error('No RPG file path provided. Server will start without a pre-loaded RPG.')
    console.error('Usage: bun run src/mcp/server.ts <rpg-file.json> [--no-search]')
    console.error(
      'Note: rpg_encode tool will still work, but other tools require an RPG to be loaded.',
    )
  }

  const server = createMcpServer(rpg, semanticSearch)
  const transport = new StdioServerTransport()

  await server.connect(transport)
  console.error('RPG MCP server started')
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

  const semanticSearch = new SemanticSearch({
    dbPath,
    tableName: 'rpg_nodes',
    embedding,
  })

  // Skip indexing if vector DB already exists
  const existingCount = existsSync(dbPath) ? await semanticSearch.count() : 0
  if (existingCount > 0) {
    console.error(`Semantic search ready (${existingCount} nodes already indexed)`)
    return semanticSearch
  }

  // Index all RPG nodes
  const nodes = await rpg.getNodes()
  console.error(`Indexing ${nodes.length} nodes for semantic search...`)

  const documents = nodes.map(node => ({
    id: node.id,
    content: `${node.feature.description} ${(node.feature.keywords ?? []).join(' ')} ${node.metadata?.path ?? ''}`,
    metadata: {
      entityType: node.metadata?.entityType,
      path: node.metadata?.path,
    },
  }))

  await semanticSearch.indexBatch(documents)
  console.error(`Semantic search ready (${documents.length} nodes indexed)`)

  return semanticSearch
}

// Run if executed directly
if (import.meta.main) {
  main().catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}
