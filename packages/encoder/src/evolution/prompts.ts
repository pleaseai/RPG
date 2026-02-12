/**
 * LLM prompt templates for RPG Evolution operations
 */
import { z } from 'zod/v4'

/**
 * Semantic Routing Prompt — used by FindBestParent
 *
 * Given a new entity's feature description and a list of candidate parent
 * categories, the LLM selects the most semantically compatible parent.
 */
export function buildSemanticRoutingPrompt(
  entityFeature: string,
  candidates: Array<{ id: string, description: string }>,
): { prompt: string, systemPrompt: string } {
  const candidateList = candidates.map((c, i) => `${i + 1}. [${c.id}]: ${c.description}`).join('\n')

  return {
    systemPrompt: `You are a code architecture classifier. Your task is to route a code entity to the most semantically compatible category in a hierarchical codebase graph.

Respond with ONLY valid JSON in this exact format:
{"selectedId": "<category_id or null>", "confidence": <0.0-1.0>}

Rules:
- Select the category whose description is most semantically related to the entity's feature
- If no category is a good fit, set selectedId to null
- confidence should reflect how well the entity fits the selected category`,

    prompt: `Route this code entity to the best parent category.

Entity feature: ${entityFeature}

Available categories:
${candidateList}

Which category is the most semantically compatible parent for this entity?`,
  }
}

/**
 * Zod schema for semantic routing response
 */
export const SemanticRoutingResponseSchema = z.object({
  selectedId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
})

/**
 * Response type for semantic routing
 */
export type SemanticRoutingResponse = z.infer<typeof SemanticRoutingResponseSchema>
