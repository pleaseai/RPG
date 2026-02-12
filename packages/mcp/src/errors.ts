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
 * Custom error class for RPG MCP operations
 */
export class RPGError extends Error {
  constructor(
    public code: RPGErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'RPGError'
  }
}

/**
 * Create an RPG not loaded error
 */
export function rpgNotLoadedError(): RPGError {
  return new RPGError(
    RPGErrorCode.RPG_NOT_LOADED,
    'RPG is not loaded. Server requires an RPG file path at startup.',
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
