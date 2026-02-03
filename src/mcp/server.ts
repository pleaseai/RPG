import { readFile } from 'node:fs/promises'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { RepositoryPlanningGraph } from '../graph'
import { RPGError, invalidPathError } from './errors'
import {
  EncodeInputSchema,
  ExploreInputSchema,
  FetchInputSchema,
  RPG_TOOLS,
  SearchInputSchema,
  StatsInputSchema,
  executeEncode,
  executeExplore,
  executeFetch,
  executeSearch,
  executeStats,
} from './tools'

/**
 * Create and configure the MCP server for RPG tools
 */
export function createMcpServer(rpg: RepositoryPlanningGraph | null): McpServer {
  const server = new McpServer({
    name: 'rpg-mcp-server',
    version: '0.1.0',
  })

  // Register all RPG tools
  server.tool(
    RPG_TOOLS.rpg_search.name,
    RPG_TOOLS.rpg_search.description,
    SearchInputSchema.shape,
    async (args) => wrapHandler(() => executeSearch(rpg, SearchInputSchema.parse(args)))
  )

  server.tool(
    RPG_TOOLS.rpg_fetch.name,
    RPG_TOOLS.rpg_fetch.description,
    FetchInputSchema.shape,
    async (args) => wrapHandler(() => executeFetch(rpg, FetchInputSchema.parse(args)))
  )

  server.tool(
    RPG_TOOLS.rpg_explore.name,
    RPG_TOOLS.rpg_explore.description,
    ExploreInputSchema.shape,
    async (args) => wrapHandler(() => executeExplore(rpg, ExploreInputSchema.parse(args)))
  )

  server.tool(
    RPG_TOOLS.rpg_encode.name,
    RPG_TOOLS.rpg_encode.description,
    EncodeInputSchema.shape,
    async (args) => wrapHandler(() => executeEncode(EncodeInputSchema.parse(args)))
  )

  server.tool(
    RPG_TOOLS.rpg_stats.name,
    RPG_TOOLS.rpg_stats.description,
    StatsInputSchema.shape,
    async () => wrapHandler(() => executeStats(rpg))
  )

  return server
}

/**
 * Wrap a handler function with standard MCP response formatting
 */
async function wrapHandler<T>(
  handler: () => T | Promise<T>
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: true }> {
  try {
    const result = await handler()
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  } catch (error) {
    return formatError(error)
  }
}

/**
 * Format error for MCP response
 */
function formatError(error: unknown): {
  content: Array<{ type: 'text'; text: string }>
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
    return RepositoryPlanningGraph.fromJSON(content)
  } catch (error) {
    throw invalidPathError(filePath)
  }
}

/**
 * Main entry point for the MCP server
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2)

  let rpg: RepositoryPlanningGraph | null = null

  if (args.length > 0) {
    const rpgPath = args[0]
    try {
      console.error(`Loading RPG from: ${rpgPath}`)
      rpg = await loadRPG(rpgPath)
      console.error(`RPG loaded: ${rpg.getConfig().name}`)
    } catch (error) {
      console.error(`Failed to load RPG: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  } else {
    console.error('No RPG file path provided. Server will start without a pre-loaded RPG.')
    console.error('Usage: bun run src/mcp/server.ts <rpg-file.json>')
    console.error(
      'Note: rpg_encode tool will still work, but other tools require an RPG to be loaded.'
    )
  }

  const server = createMcpServer(rpg)
  const transport = new StdioServerTransport()

  await server.connect(transport)
  console.error('RPG MCP server started')
}

// Run if executed directly
if (import.meta.main) {
  main().catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}
