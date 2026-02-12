import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { InteractiveState } from './state'
import { InteractiveEncoder } from './encoder'
import { registerInteractivePrompts } from './prompts'
import { registerInteractiveResources } from './resources'
import { registerInteractiveTools } from './tools'

export { InteractiveEncoder } from './encoder'
export type { BuildResult, SubmitResult } from './encoder'
export { InteractiveState } from './state'
export type { FileFeatures, HierarchyAssignment, LiftableEntity, PendingRouting } from './state'

/**
 * Register the interactive encoding protocol on an MCP server.
 *
 * Adds tools (mutations), resources (read-only data), and prompts (workflow orchestration)
 * for agent-driven semantic encoding — no API keys needed.
 */
export function registerInteractiveProtocol(server: McpServer, state: InteractiveState): void {
  const encoder = new InteractiveEncoder(state)
  registerInteractiveTools(server, encoder)
  registerInteractiveResources(server, encoder)
  registerInteractivePrompts(server, encoder)
}
