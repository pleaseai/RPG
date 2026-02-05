import type { Embedding } from './embedding'
import { VectorStore } from '../utils/vector'

/**
 * Semantic search options
 */
export interface SemanticSearchOptions {
  /** Database path for vector storage */
  dbPath: string
  /** Table name for vector storage */
  tableName?: string
  /** Embedding provider instance */
  embedding: Embedding
}

/**
 * Document to index
 */
export interface IndexableDocument {
  /** Unique document ID (e.g., node ID) */
  id: string
  /** Text content for embedding (e.g., semantic feature) */
  content: string
  /** Additional metadata to store with the document */
  metadata?: Record<string, unknown>
}

/**
 * Search result with node information
 */
export interface SemanticSearchResult {
  /** Node ID */
  id: string
  /** Similarity score (lower is better for L2 distance) */
  score: number
  /** Original content that was indexed */
  content: string
  /** Associated metadata */
  metadata?: Record<string, unknown>
}

/**
 * Semantic Search for RPG nodes
 *
 * Combines embedding generation with vector storage to enable
 * natural language search over RPG nodes.
 *
 * Features:
 * - Index RPG nodes by their semantic features
 * - Search using natural language queries
 * - Batch indexing for efficiency
 */
export class SemanticSearch {
  private options: SemanticSearchOptions
  private vectorStore: VectorStore
  private embedding: Embedding

  constructor(options: SemanticSearchOptions) {
    this.options = {
      tableName: 'rpg_nodes',
      ...options,
    }
    this.embedding = options.embedding
    this.vectorStore = new VectorStore({
      dbPath: this.options.dbPath,
      tableName: this.options.tableName ?? 'rpg_nodes',
      dimension: this.embedding.getDimension(),
    })
  }

  /**
   * Index a single document
   */
  async index(document: IndexableDocument): Promise<void> {
    const embeddingResult = await this.embedding.embed(document.content)

    await this.vectorStore.add([
      {
        id: document.id,
        text: document.content,
        vector: embeddingResult.vector,
        metadata: document.metadata,
      },
    ])
  }

  /**
   * Index multiple documents in batch
   */
  async indexBatch(documents: IndexableDocument[]): Promise<void> {
    if (documents.length === 0) {
      return
    }

    // Generate embeddings in batch
    const contents = documents.map(doc => doc.content)
    const embeddingResults = await this.embedding.embedBatch(contents)

    // Prepare documents for vector store
    const vectorDocs = documents.map((doc, index) => {
      const embeddingResult = embeddingResults[index]
      if (!embeddingResult) {
        throw new Error(`Missing embedding result for document ${doc.id}`)
      }
      return {
        id: doc.id,
        text: doc.content,
        vector: embeddingResult.vector,
        metadata: doc.metadata,
      }
    })

    await this.vectorStore.add(vectorDocs)
  }

  /**
   * Search for similar documents using natural language query
   */
  async search(query: string, topK = 10): Promise<SemanticSearchResult[]> {
    // Generate embedding for query
    const queryEmbedding = await this.embedding.embed(query)

    // Search vector store
    const results = await this.vectorStore.search(queryEmbedding.vector, topK)

    return results.map(result => ({
      id: result.id,
      score: result.score,
      content: result.text,
      metadata: result.metadata,
    }))
  }

  /**
   * Search using a pre-computed embedding vector
   */
  async searchByVector(queryVector: number[], topK = 10): Promise<SemanticSearchResult[]> {
    const results = await this.vectorStore.search(queryVector, topK)

    return results.map(result => ({
      id: result.id,
      score: result.score,
      content: result.text,
      metadata: result.metadata,
    }))
  }

  /**
   * Hybrid search combining vector similarity and BM25 full-text search.
   * Generates an embedding for the query and runs both vector + FTS search with RRF reranking.
   */
  async searchHybrid(
    query: string,
    topK = 10,
    vectorWeight = 0.7,
  ): Promise<SemanticSearchResult[]> {
    const queryEmbedding = await this.embedding.embed(query)

    const results = await this.vectorStore.searchHybrid({
      textQuery: query,
      queryVector: queryEmbedding.vector,
      mode: 'hybrid',
      topK,
      vectorWeight,
    })

    return results.map(result => ({
      id: result.id,
      score: result.score,
      content: result.text,
      metadata: result.metadata,
    }))
  }

  /**
   * Full-text search using BM25 scoring (no embedding required)
   */
  async searchFts(query: string, topK = 10): Promise<SemanticSearchResult[]> {
    const results = await this.vectorStore.searchFts(query, topK)

    return results.map(result => ({
      id: result.id,
      score: result.score,
      content: result.text,
      metadata: result.metadata,
    }))
  }

  /**
   * Delete documents by ID
   */
  async delete(ids: string[]): Promise<void> {
    await this.vectorStore.delete(ids)
  }

  /**
   * Clear all indexed documents
   */
  async clear(): Promise<void> {
    await this.vectorStore.clear()
  }

  /**
   * Get number of indexed documents
   */
  async count(): Promise<number> {
    try {
      return await this.vectorStore.count()
    }
    catch {
      // Table doesn't exist yet
      return 0
    }
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    await this.vectorStore.close()
  }

  /**
   * Get the embedding provider
   */
  getEmbedding(): Embedding {
    return this.embedding
  }

  /**
   * Get the underlying vector store
   */
  getVectorStore(): VectorStore {
    return this.vectorStore
  }
}
