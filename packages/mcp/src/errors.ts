/**
 * MCP Error codes for RPG operations
 */
export const RPGErrorCode = {
  RPG_NOT_LOADED: 'RPG_NOT_LOADED',
  NODE_NOT_FOUND: 'NODE_NOT_FOUND',
  INVALID_PATH: 'INVALID_PATH',
  ENCODE_FAILED: 'ENCODE_FAILED',
  EVOLVE_FAILED: 'EVOLVE_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
} as const

export type RPGErrorCode = (typeof RPGErrorCode)[keyof typeof RPGErrorCode]

/**
 * Actionable hint surfaced to the AI agent when no RPG graph is loaded.
 *
 * Mirrors the `_ENCODE_HINT` constant from the Python reference at
 * `vendor/RPG-ZeroRepo/RPG-Kit/scripts/mcp_server.py`. The agent is
 * expected to relay this verbatim to the user so they know what to do.
 */
export const ENCODE_HINT
  = 'Run `soop encode <repo-path>` (or call the `soop_encode` MCP tool) to build .soop/graph.json. '
    + 'Once it finishes, RPG tools will start working on the next call — no need to restart the MCP server.'

/**
 * Custom error class for RPG MCP operations
 */
export class RPGError extends Error {
  constructor(
    public code: RPGErrorCode,
    message: string,
    public nextStep?: string,
    public details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'RPGError'
  }

  /**
   * Render a JSON-serializable payload suitable for MCP `content[0].text`.
   * Always includes `code` and `message`; `nextStep` and `details` are
   * included only when present. Stable shape across all tools.
   */
  toPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      error: this.code,
      message: this.message,
    }
    if (this.nextStep !== undefined) {
      payload.nextStep = this.nextStep
    }
    if (this.details !== undefined) {
      payload.details = this.details
    }
    return payload
  }
}

/**
 * Create an RPG-not-loaded error with an actionable `nextStep` hint.
 *
 * Backwards-compatible: calling with no arguments still produces an error
 * whose `code === 'RPG_NOT_LOADED'` and whose message contains "not loaded",
 * matching the assertions in `packages/mcp/tests/mcp.test.ts`.
 */
export function rpgNotLoadedError(
  opts: { rpgFile?: string, reason?: string } = {},
): RPGError {
  const details: Record<string, unknown> = {
    reason: opts.reason ?? 'no_path_configured',
  }
  if (opts.rpgFile !== undefined) {
    details.rpgFile = opts.rpgFile
  }
  return new RPGError(
    RPGErrorCode.RPG_NOT_LOADED,
    'RPG graph is not loaded. Server requires an RPG file at startup or via lazy reload.',
    ENCODE_HINT,
    details,
  )
}

/**
 * Create a node not found error
 */
export function nodeNotFoundError(nodeId: string): RPGError {
  return new RPGError(RPGErrorCode.NODE_NOT_FOUND, `Node not found: ${nodeId}`)
}

/**
 * Create an invalid path error
 */
export function invalidPathError(path: string): RPGError {
  return new RPGError(RPGErrorCode.INVALID_PATH, `Invalid path: ${path}`)
}

/**
 * Create an encode failed error
 */
export function encodeFailedError(reason: string): RPGError {
  return new RPGError(RPGErrorCode.ENCODE_FAILED, `Encoding failed: ${reason}`)
}

/**
 * Create an evolution failed error
 */
export function evolveFailedError(reason: string): RPGError {
  return new RPGError(RPGErrorCode.EVOLVE_FAILED, `Evolution failed: ${reason}`)
}

/**
 * Create an invalid input error
 */
export function invalidInputError(reason: string): RPGError {
  return new RPGError(RPGErrorCode.INVALID_INPUT, `Invalid input: ${reason}`)
}
