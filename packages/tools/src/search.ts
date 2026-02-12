import type { SemanticSearch } from '@pleaseai/rpg-encoder/semantic-search'
import type { Node, RepositoryPlanningGraph } from '@pleaseai/rpg-graph'

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
    const results = await this.resolveResults(options)
    const uniqueNodes = Array.from(new Map(results.map(n => [n.id, n])).values())

    return {
      nodes: uniqueNodes,
      totalMatches: uniqueNodes.length,
      mode: options.mode,
    }
  }

  private async resolveResults(options: SearchOptions): Promise<Node[]> {
    if (options.mode === 'snippets') {
      return options.filePattern ? this.rpg.searchByPath(options.filePattern) : []
    }

    // Both 'features' and 'auto' start with feature search
    const featureResults = options.featureTerms
      ? await this.searchFeatures(
          options.featureTerms,
          this.resolveStrategy(options.searchStrategy),
          options.searchScopes,
        )
      : []

    if (options.mode === 'features') {
      return featureResults
    }

    // Auto mode: staged fallback per paper §5.1
    // Snippet search only triggers when feature results are empty (no feature matches)
    if (featureResults.length > 0 || !options.filePattern) {
      return featureResults
    }
    return this.rpg.searchByPath(options.filePattern)
  }

  private resolveStrategy(explicit?: SearchStrategy): SearchStrategy {
    return explicit ?? (this.semanticSearch ? 'hybrid' : 'string')
  }

  /**
   * Search by feature terms using the configured strategy
   */
  private async searchFeatures(
    featureTerms: string[],
    strategy: SearchStrategy,
    scopes?: string[],
  ): Promise<Node[]> {
    if (strategy === 'string' || !this.semanticSearch) {
      return this.searchByString(featureTerms, scopes)
    }

    const results = await this.searchBySemantic(featureTerms, strategy, this.semanticSearch)
    if (!scopes || scopes.length === 0)
      return results

    const subtreeIds = await this.collectSubtreeIds(scopes)
    return results.filter(node => subtreeIds.has(node.id))
  }

  private async searchByString(terms: string[], scopes?: string[]): Promise<Node[]> {
    const results: Node[] = []
    for (const term of terms) {
      results.push(...await this.rpg.searchByFeature(term, scopes))
    }
    return results
  }

  private async searchBySemantic(
    terms: string[],
    strategy: SearchStrategy,
    semanticSearch: SemanticSearch,
  ): Promise<Node[]> {
    const results: Node[] = []
    for (const term of terms) {
      const hits = await this.executeSemanticQuery(semanticSearch, term, strategy)
      for (const hit of hits) {
        const node = await this.rpg.getNode(hit.id)
        if (node)
          results.push(node)
      }
    }
    return results
  }

  private executeSemanticQuery(search: SemanticSearch, term: string, strategy: SearchStrategy) {
    if (strategy === 'hybrid')
      return search.searchHybrid(term)
    if (strategy === 'fts')
      return search.searchFts(term)
    return search.search(term)
  }

  private async collectSubtreeIds(scopes: string[]): Promise<Set<string>> {
    const ids = new Set<string>()
    const queue: string[] = [...scopes]
    for (const current of queue) {
      if (ids.has(current))
        continue
      ids.add(current)
      const children = await this.rpg.getChildren(current)
      for (const child of children) {
        if (!ids.has(child.id))
          queue.push(child.id)
      }
    }
    return ids
  }
}
