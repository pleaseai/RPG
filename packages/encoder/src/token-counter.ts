import type { EntityInput } from './semantic'

/**
 * Characters per token (standard approximation for English and code text)
 */
const CHARS_PER_TOKEN = 4

/**
 * Prompt template overhead tokens (system prompt, entity metadata, formatting)
 */
const PROMPT_OVERHEAD_TOKENS = 200

/**
 * Estimate token count for source code text
 * Uses character-based approximation: ~4 characters per token (standard for English/code)
 *
 * @param text - Source code text to estimate
 * @returns Estimated token count
 */
export function estimateTokenCount(text: string): number {
  if (!text || text.length === 0) {
    return 0
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * Estimate tokens for a single entity including source code and documentation
 *
 * @param entity - Entity to estimate tokens for
 * @returns Total token count including prompt overhead
 */
export function estimateEntityTokens(entity: EntityInput): number {
  let totalTokens = PROMPT_OVERHEAD_TOKENS

  // Add source code tokens if provided
  if (entity.sourceCode && typeof entity.sourceCode === 'string') {
    totalTokens += estimateTokenCount(entity.sourceCode)
  }

  // Add documentation tokens if provided
  if (entity.documentation && typeof entity.documentation === 'string') {
    totalTokens += estimateTokenCount(entity.documentation)
  }

  return totalTokens
}

/**
 * Estimate tokens for a batch of entities
 *
 * @param entities - Array of entities to estimate
 * @returns Total token count for all entities
 */
export function estimateBatchTokens(entities: EntityInput[]): number {
  return entities.reduce((total, entity) => total + estimateEntityTokens(entity), 0)
}
