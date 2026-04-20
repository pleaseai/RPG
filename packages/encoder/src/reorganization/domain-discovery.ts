import type { CallOptions, LLMClient } from '@pleaseai/soop-utils/llm'
import type { DomainDiscoveryResult, FileFeatureGroup } from './types'
import { createLogger } from '@pleaseai/soop-utils/logger'
import { buildDomainDiscoveryPrompt } from './prompts'

const log = createLogger('DomainDiscovery')

/**
 * Domain Discovery — identify functional areas from file-level features.
 *
 * Implements paper §3.2 Step 1: "Functional Abstraction"
 * - Compresses to file-level features only (granularity-based input compression)
 * - LLM analyzes the complete repository-wide semantic manifold
 * - Returns abstract functional centroids (PascalCase names)
 *
 * Area 6: Iterative Domain Discovery with Refinement
 * - Runs discovery `maxIterations` times (default 3) to collect candidate sets
 * - Synthesizes results via frequency-based voting with 1-8 area constraint
 * - Supports think/solution block parsing for structured LLM output
 */
export class DomainDiscovery {
  constructor(private readonly llmClient: LLMClient) {}

  async discover(
    fileGroups: FileFeatureGroup[],
    options?: {
      maxIterations?: number
      repoName?: string
      repoInfo?: string
      skeleton?: string
      callOptions?: CallOptions
    },
  ): Promise<DomainDiscoveryResult> {
    const maxIterations = options?.maxIterations ?? 3
    const allCandidates: string[][] = []

    for (let i = 0; i < maxIterations; i++) {
      try {
        const { system, user } = buildDomainDiscoveryPrompt(
          fileGroups,
          options?.repoName,
          options?.repoInfo,
          options?.skeleton,
        )
        const response = await this.llmClient.complete(user, system, options?.callOptions)
        const areas = this.parseAreasFromResponse(response.content)
        if (areas.length > 0) {
          allCandidates.push(areas)
        }
      }
      catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        log.warn(`Iteration ${i + 1} failed: ${msg}`)
      }
    }

    if (allCandidates.length === 0) {
      throw new Error('Domain Discovery: all iterations failed to return valid functional areas')
    }

    const merged = this.synthesizeCandidates(allCandidates)
    return { functionalAreas: merged }
  }

  private parseAreasFromResponse(text: string): string[] {
    // Try to extract from <solution>...</solution> block
    const solutionMatch = text.match(/<solution>\s*([\s\S]*?)\s*<\/solution>/)
    if (solutionMatch) {
      const content = solutionMatch[1]!.trim()
      try {
        // Try JSON array or object
        const parsed = JSON.parse(content)
        if (Array.isArray(parsed)) {
          return this.validateAreas(parsed)
        }
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.functionalAreas)) {
          return this.validateAreas(parsed.functionalAreas)
        }
      }
      catch (error) {
        log.debug(`Solution block is not JSON, trying line-by-line parsing: ${error instanceof Error ? error.message : String(error)}`)
        return this.validateAreas(content.split('\n').map(l => l.trim()).filter(Boolean))
      }
    }

    // Try JSON object with functionalAreas key
    const jsonMatch = text.match(/\{[\s\S]*"functionalAreas"[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        if (parsed.functionalAreas && Array.isArray(parsed.functionalAreas)) {
          return this.validateAreas(parsed.functionalAreas)
        }
      }
      catch (error) {
        log.debug(`Failed to parse functionalAreas JSON: ${error instanceof Error ? error.message : String(error)}`)
        // Fall through to array extraction
      }
    }

    // Try JSON array directly
    const arrayMatch = text.match(/\[[\s\S]*\]/)
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0])
        if (Array.isArray(parsed)) {
          return this.validateAreas(parsed)
        }
      }
      catch (error) {
        log.debug(`Failed to parse JSON array: ${error instanceof Error ? error.message : String(error)}`)
        // Fall through
      }
    }

    return []
  }

  private synthesizeCandidates(allCandidates: string[][]): string[] {
    const counts = new Map<string, number>()

    for (const batch of allCandidates) {
      for (const area of batch) {
        const normalized = this.toPascalCase(area)
        if (normalized.length === 0)
          continue
        counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
      }
    }

    if (counts.size === 0) {
      throw new Error('Domain Discovery: synthesis produced no valid functional areas')
    }

    // Sort by frequency (descending), then alphabetically for determinism
    const sorted = [...counts].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en')).map(([area]) => area)

    // Enforce 1-8 constraint
    return sorted.slice(0, 8)
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
      if (normalized.length === 0)
        continue
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
      .split(/[^a-z0-9]+/i)
      .filter(word => word.length > 0)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('')
  }
}
