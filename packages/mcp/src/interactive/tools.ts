import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { InteractiveEncoder, SubmitResult } from './encoder'
import { z } from 'zod/v4'

/**
 * Register interactive encoding tools on the MCP server.
 *
 * 6 mutation tools with full schemas, annotations, and structured text outputs.
 */
export function registerInteractiveTools(server: McpServer, encoder: InteractiveEncoder): void {
  server.registerTool(
    'rpg_build_index',
    {
      title: 'Build Structural Index',
      description: `Build a structural graph from a repository (AST parsing + dependency edges, no semantic features).

This is the first step of interactive encoding. It discovers files, parses AST, creates graph nodes with placeholder features, and injects dependency edges.

Args:
  - repoPath (string): Absolute or relative path to the repository root.
  - include (string[], optional): Glob patterns to include (default: ["**/*.ts", "**/*.js", "**/*.py"]).
  - exclude (string[], optional): Glob patterns to exclude (default: node_modules, dist, .git).

Returns:
  Entity/file/batch counts and next action guidance.`,
      inputSchema: {
        repoPath: z.string().describe('Repository path to index'),
        include: z.array(z.string()).optional().describe('Glob patterns to include'),
        exclude: z.array(z.string()).optional().describe('Glob patterns to exclude'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ repoPath, include, exclude }) => {
      try {
        const result = await encoder.buildIndex(repoPath, { include, exclude })
        return {
          content: [{ type: 'text' as const, text: formatBuildResult(result) }],
        }
      }
      catch (error) {
        return formatToolError(error)
      }
    },
  )

  server.registerTool(
    'rpg_submit_features',
    {
      title: 'Submit Semantic Features',
      description: `Apply semantic features to entities in the RPG graph.

Submit features extracted by analyzing source code. Features should be verb+object format.

Args:
  - features (string): JSON mapping entity IDs to feature arrays.
    Example: {"src/cli.ts:function:main:1": ["parse CLI arguments", "run main loop"]}

Returns:
  Coverage update and next action guidance.

Error Handling:
  - Returns "Entity not found: <id>" if entity ID doesn't match any graph node.
  - Returns "Invalid JSON" if features string is malformed.`,
      inputSchema: {
        features: z.string().describe('JSON: {"entity_id": ["feature1", "feature2"], ...}'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ features }) => {
      try {
        const result = await encoder.submitFeatures(features)
        return {
          content: [{ type: 'text' as const, text: formatSubmitResult('Features submitted', result) }],
        }
      }
      catch (error) {
        return formatToolError(error)
      }
    },
  )

  server.registerTool(
    'rpg_finalize_features',
    {
      title: 'Finalize Features',
      description: `Aggregate entity features into file-level descriptions and auto-route drifted entities.

Call this after all entity features have been submitted. It:
1. Aggregates child entity features into file-level features (dedup-only)
2. Queues any drifted entities for routing

No arguments required.

Returns:
  File feature count and routing status.`,
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const result = await encoder.finalizeFeatures()
        return {
          content: [{ type: 'text' as const, text: formatSubmitResult('Features finalized', result) }],
        }
      }
      catch (error) {
        return formatToolError(error)
      }
    },
  )

  server.registerTool(
    'rpg_submit_synthesis',
    {
      title: 'Submit File Synthesis',
      description: `Apply holistic file-level feature synthesis.

Submit synthesized descriptions that capture each file's role in the broader system.

Args:
  - synthesis (string): JSON mapping file paths to synthesized features.
    Example: {"src/encoder/encoder.ts": {"description": "encode repositories into planning graphs", "keywords": ["encoder", "rpg"]}}

Returns:
  Synthesis progress.`,
      inputSchema: {
        synthesis: z.string().describe('JSON: {"file_path": {"description": "...", "keywords": [...]}, ...}'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ synthesis }) => {
      try {
        const result = await encoder.submitSynthesis(synthesis)
        return {
          content: [{ type: 'text' as const, text: formatSubmitResult('Synthesis submitted', result) }],
        }
      }
      catch (error) {
        return formatToolError(error)
      }
    },
  )

  server.registerTool(
    'rpg_submit_hierarchy',
    {
      title: 'Submit Hierarchy',
      description: `Apply 3-level hierarchy assignments to files.

Submit the functional area / category / subcategory path for each file.

Args:
  - assignments (string): JSON mapping file paths to hierarchy paths.
    Example: {"src/encoder/encoder.ts": "SemanticAnalysis/code encoding/repository extraction"}

Returns:
  Hierarchy construction status.`,
      inputSchema: {
        assignments: z.string().describe('JSON: {"file_path": "Area/category/subcategory", ...}'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ assignments }) => {
      try {
        const result = await encoder.submitHierarchy(assignments)
        return {
          content: [{ type: 'text' as const, text: formatSubmitResult('Hierarchy submitted', result) }],
        }
      }
      catch (error) {
        return formatToolError(error)
      }
    },
  )

  server.registerTool(
    'rpg_submit_routing',
    {
      title: 'Submit Routing Decisions',
      description: `Apply routing decisions for entities that drifted from their hierarchy location.

Args:
  - decisions (string): JSON array of routing decisions.
    Example: [{"entityId": "src/foo.ts:file", "decision": "keep"}, {"entityId": "src/bar.ts:file", "decision": "move", "targetPath": "Area/cat/sub"}]
  - revision (string): Graph revision from rpg://encoding/routing to prevent stale decisions.

Error Handling:
  - Returns "Stale revision" if the graph has changed since the routing candidates were read.

Returns:
  Routing progress.`,
      inputSchema: {
        decisions: z.string().describe('JSON: [{"entityId": "...", "decision": "keep|move|split", "targetPath?": "..."}, ...]'),
        revision: z.string().describe('Graph revision from rpg://encoding/routing'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ decisions, revision }) => {
      try {
        const result = await encoder.submitRouting(decisions, revision)
        return {
          content: [{ type: 'text' as const, text: formatSubmitResult('Routing submitted', result) }],
        }
      }
      catch (error) {
        return formatToolError(error)
      }
    },
  )
}

// ==================== Formatting Helpers ====================

function formatBuildResult(result: { success: boolean, entities: number, files: number, batches: number, nextAction: string }): string {
  return [
    `## Build Index Complete`,
    ``,
    `- Files: ${result.files}`,
    `- Entities: ${result.entities}`,
    `- Batches: ${result.batches}`,
    ``,
    `**Next:** ${result.nextAction}`,
  ].join('\n')
}

function formatSubmitResult(title: string, result: SubmitResult): string {
  const lines = [
    `## ${title}`,
    ``,
    `- Processed: ${result.entitiesProcessed}`,
    `- Coverage: ${result.coveragePercent.toFixed(1)}%`,
  ]
  if (result.driftDetected) {
    lines.push(`- Drift detected: ${result.driftDetected}`)
  }
  lines.push('', `**Next:** ${result.nextAction}`)
  return lines.join('\n')
}

function formatToolError(error: unknown): {
  content: Array<{ type: 'text', text: string }>
  isError: true
} {
  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  }
}
