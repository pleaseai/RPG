import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { InteractiveEncoder } from './encoder'
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * Register interactive encoding resources on the MCP server.
 *
 * 5 read-only resources providing data for the agent to analyze.
 */
export function registerInteractiveResources(server: McpServer, encoder: InteractiveEncoder): void {
  // Static resource: encoding status dashboard
  server.registerResource(
    'rpg-encoding-status',
    'rpg://encoding/status',
    {
      description: 'Lifting coverage dashboard: lifted/total, per-area progress, next step',
      mimeType: 'text/markdown',
    },
    async uri => ({
      contents: [{
        uri: uri.href,
        mimeType: 'text/markdown',
        text: encoder.getStatus(),
      }],
    }),
  )

  // Template resource: entity batches
  server.registerResource(
    'rpg-encoding-entities',
    new ResourceTemplate('rpg://encoding/entities/{scope}/{batch}', { list: undefined }),
    {
      description: 'Entity batch with source code for semantic lifting. Batch 0 includes parsing instructions.',
      mimeType: 'text/markdown',
    },
    async (uri, { scope, batch }) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'text/markdown',
        text: encoder.getEntityBatch(String(scope), Number(batch)),
      }],
    }),
  )

  // Static resource: hierarchy context
  server.registerResource(
    'rpg-encoding-hierarchy',
    'rpg://encoding/hierarchy',
    {
      description: 'Current file features with domain discovery and hierarchy assignment instructions',
      mimeType: 'text/markdown',
    },
    async uri => ({
      contents: [{
        uri: uri.href,
        mimeType: 'text/markdown',
        text: encoder.getHierarchyContext(),
      }],
    }),
  )

  // Template resource: routing candidates
  server.registerResource(
    'rpg-encoding-routing',
    new ResourceTemplate('rpg://encoding/routing/{batch}', { list: undefined }),
    {
      description: 'Pending routing candidates with hierarchy context and graph revision',
      mimeType: 'text/markdown',
    },
    async (uri, { batch }) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'text/markdown',
        text: encoder.getRoutingBatch(Number(batch)),
      }],
    }),
  )

  // Template resource: synthesis batches
  server.registerResource(
    'rpg-encoding-synthesis',
    new ResourceTemplate('rpg://encoding/synthesis/{batch}', { list: undefined }),
    {
      description: 'File-level entity features for holistic synthesis',
      mimeType: 'text/markdown',
    },
    async (uri, { batch }) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'text/markdown',
        text: encoder.getSynthesisBatch(Number(batch)),
      }],
    }),
  )
}
