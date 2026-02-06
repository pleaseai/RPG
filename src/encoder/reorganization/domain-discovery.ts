import type { LLMClient } from '../../utils/llm'
import type { DomainDiscoveryResult, FileFeatureGroup } from './types'
import { buildDomainDiscoveryPrompt, parseSolutionTag } from './prompts'

/**
 * Domain Discovery — identify functional areas from file-level features.
 *
 * Implements paper §3.2 Step 1: "Functional Abstraction"
 * - Compresses to file-level features only (granularity-based input compression)
 * - LLM analyzes the complete repository-wide semantic manifold
 * - Returns abstract functional centroids (PascalCase names)
 */
export class DomainDiscovery {
  constructor(private llmClient: LLMClient) {}

  async discover(fileGroups: FileFeatureGroup[]): Promise<DomainDiscoveryResult> {
    const { system, user } = buildDomainDiscoveryPrompt(fileGroups)

    let response: string
    try {
      const result = await this.llmClient.complete(user, system)
      response = result.content
    }
    catch (err) {
      throw new Error(
        `Domain Discovery LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    let areas: string[]
    try {
      areas = parseSolutionTag<string[]>(response)
    }
    catch {
      // Retry once with format correction
      const retryResult = await this.llmClient.complete(
        `${user}\n\nIMPORTANT: Your previous response did not contain valid <solution> tags with a JSON array. Please respond with ONLY a JSON array of functional area names wrapped in <solution> tags.`,
        system,
      )
      areas = parseSolutionTag<string[]>(retryResult.content)
    }

    // Validate: ensure all returned areas are non-empty PascalCase strings
    const validated = this.validateAreas(areas)

    return { functionalAreas: validated }
  }

  private validateAreas(areas: unknown): string[] {
    if (!Array.isArray(areas)) {
      throw new TypeError('Domain Discovery: expected an array of functional area names')
    }

    const seen = new Set<string>()
    const result: string[] = []

    for (const area of areas) {
      if (typeof area !== 'string' || area.trim().length === 0) {
        continue
      }

      // Normalize to PascalCase if not already
      const normalized = this.toPascalCase(area.trim())
      if (!seen.has(normalized)) {
        seen.add(normalized)
        result.push(normalized)
      }
    }

    if (result.length === 0) {
      throw new Error('Domain Discovery: LLM returned no valid functional areas')
    }

    return result
  }

  private toPascalCase(str: string): string {
    // Already PascalCase — starts with uppercase and has no spaces/underscores
    if (/^[A-Z][a-zA-Z0-9]*$/.test(str)) {
      return str
    }

    // Convert from various formats: "data processing" -> "DataProcessing",
    // "data_processing" -> "DataProcessing", "dataProcessing" -> "DataProcessing"
    return str
      .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase → separate words
      .split(/[\s_-]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('')
  }
}
