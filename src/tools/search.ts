import type { SemanticSearch } from '../encoder/semantic-search'
import type { Node, RepositoryPlanningGraph } from '../graph'

/**
 * Search mode
 */
export type SearchMode = 'features' | 'snippets' | 'auto'

/**
 * Search strategy for feature-based search
 */
export type SearchStrategy = 'hybrid' | 'vector' | 'fts' | 'string'

/**
 * Options for SearchNode
 */
export interface SearchOptions {
  /** Search mode: features (semantic), snippets (code), or auto (both) */
  mode: SearchMode
  /** Behavioral/functionality phrases for feature search */
  featureTerms?: string[]
  /** File paths, entities, or keywords for snippet search */
  searchTerms?: string[]
  /** Feature paths to restrict search scope */
  searchScopes?: string[]
  /** File path or glob pattern to restrict snippet search */
  filePattern?: string
  /** Line range [start, end] for specific file extraction */
  lineRange?: [number, number]
  /** Search strategy for feature search (default: hybrid if semanticSearch available, otherwise string) */
  searchStrategy?: SearchStrategy
}

/**
 * Search result
 */
export interface SearchResult {
  /** Matched nodes */
  nodes: Node[]
  /** Total matches found */
  totalMatches: number
  /** Search mode used */
  mode: SearchMode
}

/**
 * SearchNode - Global node-level retrieval
 *
 * Maps high-level functional descriptions to concrete code entities
 * via RPG mapping, and/or retrieves code snippets via symbol/file search.
 *
 * When a SemanticSearch instance is provided, feature search uses
 * hybrid (vector + BM25) search for better quality results.
 */
export class SearchNode {
  private rpg: RepositoryPlanningGraph
  private semanticSearch: SemanticSearch | null

  constructor(rpg: RepositoryPlanningGraph, semanticSearch?: SemanticSearch | null) {
    this.rpg = rpg
    this.semanticSearch = semanticSearch ?? null
  }

  /**
   * Execute a search query
   */
  async query(options: SearchOptions): Promise<SearchResult> {
    const results: Node[] = []

    if (options.mode === 'features' || options.mode === 'auto') {
      if (options.featureTerms) {
        const strategy = options.searchStrategy ?? (this.semanticSearch ? 'hybrid' : 'string')
        const featureResults = await this.searchFeatures(options.featureTerms, strategy)
        results.push(...featureResults)
      }
    }

    if (options.mode === 'snippets' || options.mode === 'auto') {
      // Path/pattern-based search
      if (options.filePattern) {
        const matches = await this.rpg.searchByPath(options.filePattern)
        results.push(...matches)
      }
    }

    // Deduplicate by node ID
    const uniqueNodes = Array.from(new Map(results.map(n => [n.id, n])).values())

    return {
      nodes: uniqueNodes,
      totalMatches: uniqueNodes.length,
      mode: options.mode,
    }
  }

  /**
   * Search by feature terms using the configured strategy
   */
  private async searchFeatures(featureTerms: string[], strategy: SearchStrategy): Promise<Node[]> {
    // Always fall back to string match if no semantic search available
    if (strategy === 'string' || !this.semanticSearch) {
      const results: Node[] = []
      for (const term of featureTerms) {
        const matches = await this.rpg.searchByFeature(term)
        results.push(...matches)
      }
      return results
    }

    // Use semantic search for vector/fts/hybrid strategies
    const results: Node[] = []
    for (const term of featureTerms) {
      const searchResults
        = strategy === 'hybrid'
          ? await this.semanticSearch.searchHybrid(term)
          : strategy === 'fts'
            ? await this.semanticSearch.searchFts(term)
            : await this.semanticSearch.search(term)

      // Map search results back to RPG nodes
      for (const sr of searchResults) {
        const node = await this.rpg.getNode(sr.id)
        if (node) {
          results.push(node)
        }
      }
    }
    return results
  }
}
