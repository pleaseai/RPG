import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { InteractiveEncoder } from './encoder'
import { z } from 'zod/v4'
import { ENCODING_WORKFLOW_INSTRUCTIONS, ROUTING_INSTRUCTIONS } from './prompt-texts'

/**
 * Register interactive encoding prompts on the MCP server.
 *
 * 2 prompts guiding the agent through multi-step workflows.
 */
export function registerInteractivePrompts(server: McpServer, encoder: InteractiveEncoder): void {
  server.registerPrompt(
    'rpg-encode-repo',
    {
      title: 'Encode Repository',
      description: 'Guide through full interactive encoding: build → lift → synthesize → hierarchy',
      argsSchema: {
        repoPath: z.string().describe('Repository path to encode'),
      },
    },
    async ({ repoPath }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: ENCODING_WORKFLOW_INSTRUCTIONS,
          },
        },
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Repository: ${repoPath}\n\nCall rpg_build_index with repoPath="${repoPath}" to begin.`,
          },
        },
      ],
    }),
  )

  server.registerPrompt(
    'rpg-route-entities',
    {
      title: 'Route Entities',
      description: 'Guide through entity routing: read candidates → decide → submit',
    },
    async () => {
      const status = encoder.getStatus()
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: ROUTING_INSTRUCTIONS,
            },
          },
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `${status}\n\nRead rpg://encoding/routing/0 to see pending candidates.`,
            },
          },
        ],
      }
    },
  )
}
