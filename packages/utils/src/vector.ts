import * as lancedb from '@lancedb/lancedb'
import { Index } from '@lancedb/lancedb'

/**
 * Vector store options
 */
export interface VectorStoreOptions {
  /** Database path (directory for LanceDB) */
  dbPath: string
  /** Table name */
  tableName: string
  /** Embedding dimension */
  dimension?: number
}

/**
 * Embedding result
 */
export interface EmbeddingResult {
  /** Original text */
  text: string
  /** Embedding vector */
  embedding: number[]
  /** Metadata */
  metadata?: Record<string, unknown>
}

/**
 * Search result from vector store
 */
export interface VectorSearchResult {
  /** Document ID */
  id: string
  /** Similarity score (distance or relevance) */
  score: number
  /** Document text */
  text: string
  /** Associated metadata */
  metadata?: Record<string, unknown>
}

/**
 * Search mode for VectorStore
 */
export type VectorSearchMode = 'vector' | 'fts' | 'hybrid'

/**
 * Options for hybrid search
 */
export interface HybridSearchOptions {
  /** Text query for FTS (BM25) search */
  textQuery: string
  /** Query vector for vector similarity search */
  queryVector: number[]
  /** Search mode */
  mode: VectorSearchMode
  /** Number of results to return */
  topK?: number
  /** Weight for vector results in RRF (0-1), FTS weight = 1 - vectorWeight */
  vectorWeight?: number
}

/**
 * Document schema for LanceDB
 */
interface VectorDocument {
  id: string
  text: string
  vector: number[]
  metadata?: string // JSON serialized metadata
  [key: string]: unknown // Allow indexing for LanceDB compatibility
}

/**
 * Vector Store using LanceDB
 *
 * LanceDB is a Bun-native, disk-based vector database that provides:
 * - Fast similarity search
 * - Persistent storage
 * - No external server required
 *
 * Used for:
 * - Feature tree embedding and retrieval
 * - Semantic similarity search
 * - Node clustering
 */
export class VectorStore {
  private options: VectorStoreOptions
  private db: lancedb.Connection | null = null
  private table: lancedb.Table | null = null
  private ftsIndexCreated = false

  constructor(options: VectorStoreOptions) {
    this.options = {
      dimension: 1536,
      ...options,
    }
  }

  /**
   * Initialize the database connection
   */
  private async ensureConnection(): Promise<lancedb.Table> {
    if (!this.db) {
      this.db = await lancedb.connect(this.options.dbPath)
    }

    if (!this.table) {
      const tableNames = await this.db.tableNames()
      if (tableNames.includes(this.options.tableName)) {
        this.table = await this.db.openTable(this.options.tableName)
      }
    }

    if (!this.table) {
      throw new Error(`Table "${this.options.tableName}" does not exist. Call add() first.`)
    }

    return this.table
  }

  /**
   * Add documents to the store
   */
  async add(
    documents: Array<{
      id: string
      text: string
      vector: number[]
      metadata?: Record<string, unknown>
    }>,
  ): Promise<void> {
    if (!this.db) {
      this.db = await lancedb.connect(this.options.dbPath)
    }

    const data: VectorDocument[] = documents.map(doc => ({
      id: doc.id,
      text: doc.text,
      vector: doc.vector,
      // Always serialize metadata to avoid LanceDB type inference issues with all-null columns
      metadata: JSON.stringify(doc.metadata ?? {}),
    }))

    const tableNames = await this.db.tableNames()
    if (tableNames.includes(this.options.tableName)) {
      // Add to existing table
      this.table = await this.db.openTable(this.options.tableName)
      await this.table.add(data)
    }
    else {
      // Create new table
      this.table = await this.db.createTable(this.options.tableName, data)
    }

    // Auto-create FTS index after adding documents
    await this.createFtsIndex()
  }

  /**
   * Search for similar documents
   */
  async search(queryVector: number[], topK = 10): Promise<VectorSearchResult[]> {
    const table = await this.ensureConnection()

    const results = await table.search(queryVector).limit(topK).toArray()

    return results.map((row) => {
      const parsedMetadata = row.metadata ? JSON.parse(row.metadata as string) : {}
      // Return undefined if metadata is empty object
      const hasMetadata = Object.keys(parsedMetadata).length > 0
      return {
        id: row.id as string,
        score: row._distance as number,
        text: row.text as string,
        metadata: hasMetadata ? parsedMetadata : undefined,
      }
    })
  }

  /**
   * Delete documents by ID
   */
  async delete(ids: string[]): Promise<void> {
    const table = await this.ensureConnection()

    // LanceDB uses SQL-like filter syntax
    const idList = ids.map(id => `'${id}'`).join(', ')
    await table.delete(`id IN (${idList})`)
  }

  /**
   * Clear all documents (drop and recreate table)
   */
  async clear(): Promise<void> {
    if (!this.db) {
      this.db = await lancedb.connect(this.options.dbPath)
    }

    const tableNames = await this.db.tableNames()
    if (tableNames.includes(this.options.tableName)) {
      await this.db.dropTable(this.options.tableName)
    }

    this.table = null
  }

  /**
   * Create FTS (Full-Text Search) index on the text column.
   * Idempotent — recreates the index if already exists.
   */
  async createFtsIndex(): Promise<void> {
    if (this.ftsIndexCreated) {
      return
    }

    const table = await this.ensureConnection()

    try {
      await table.createIndex('text', {
        config: Index.fts(),
        replace: true,
      })
      this.ftsIndexCreated = true
    }
    catch (error) {
      // If FTS index creation fails (e.g., empty table), log but don't throw
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[VectorStore] FTS index creation failed: ${message}`)
    }
  }

  /**
   * Full-text search using BM25 scoring
   */
  async searchFts(textQuery: string, topK = 10): Promise<VectorSearchResult[]> {
    const table = await this.ensureConnection()

    const results = await table
      .query()
      .fullTextSearch(textQuery, { columns: ['text'] })
      .limit(topK)
      .toArray()

    return results.map((row, index) => {
      const parsedMetadata = row.metadata ? JSON.parse(row.metadata as string) : {}
      const hasMetadata = Object.keys(parsedMetadata).length > 0
      return {
        id: row.id as string,
        // BM25 relevance score: use _score if available, otherwise rank-based
        score: (row._score as number) ?? index,
        text: row.text as string,
        metadata: hasMetadata ? parsedMetadata : undefined,
      }
    })
  }

  /**
   * Hybrid search combining vector similarity and BM25 full-text search.
   * Uses RRF (Reciprocal Rank Fusion) for result merging.
   */
  async searchHybrid(options: HybridSearchOptions): Promise<VectorSearchResult[]> {
    const topK = options.topK ?? 10
    const vectorWeight = options.vectorWeight ?? 0.7

    if (options.mode === 'vector') {
      return this.search(options.queryVector, topK)
    }

    if (options.mode === 'fts') {
      return this.searchFts(options.textQuery, topK)
    }

    // Hybrid: run both searches in parallel, then rerank
    const fetchK = topK * 2 // Fetch more candidates for better reranking
    const [vectorResults, ftsResults] = await Promise.all([
      this.search(options.queryVector, fetchK),
      this.searchFts(options.textQuery, fetchK),
    ])

    return this.rrfRerank(vectorResults, ftsResults, vectorWeight, topK)
  }

  /**
   * RRF (Reciprocal Rank Fusion) reranking.
   *
   * RRF_score(doc) = w_vector / (k + rank_vector) + w_fts / (k + rank_fts)
   * k = 60 (standard constant)
   */
  rrfRerank(
    vectorResults: VectorSearchResult[],
    ftsResults: VectorSearchResult[],
    vectorWeight = 0.7,
    topK = 10,
  ): VectorSearchResult[] {
    const k = 60
    const ftsWeight = 1 - vectorWeight
    const scores = new Map<string, { score: number, result: VectorSearchResult }>()

    // Score vector results by rank
    for (const [rank, result] of vectorResults.entries()) {
      const rrfScore = vectorWeight / (k + rank + 1)
      scores.set(result.id, { score: rrfScore, result })
    }

    // Score FTS results by rank
    for (const [rank, result] of ftsResults.entries()) {
      const rrfScore = ftsWeight / (k + rank + 1)
      const existing = scores.get(result.id)
      if (existing) {
        existing.score += rrfScore
      }
      else {
        scores.set(result.id, { score: rrfScore, result })
      }
    }

    // Sort by combined RRF score (descending) and take topK
    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ score, result }) => ({
        ...result,
        score,
      }))
  }

  /**
   * Get document count
   */
  async count(): Promise<number> {
    const table = await this.ensureConnection()
    return await table.countRows()
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    this.db = null
    this.table = null
    this.ftsIndexCreated = false
  }
}
