import type { VectorStore } from '@pleaseai/rpg-store/vector-store'
import type { Embedding } from './embedding'
import { createLogger } from '@pleaseai/rpg-utils/logger'

const log = createLogger('SemanticSearch')

/**
 * Semantic search options
 */
export interface SemanticSearchOptions {
  /** VectorStore implementation to use */
  vectorStore: VectorStore
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
  /** Similarity score */
  score: number
  /** Original content that was indexed */
  content: string
  /** Associated metadata */
  metadata?: Record<string, unknown>
}

/**
 * Semantic Search for RPG nodes
 *
 * Combines embedding generation with a VectorStore to enable
 * natural language search over RPG nodes via cosine similarity.
 * The VectorStore implementation is injected, making it easy to swap.
 */
export class SemanticSearch {
  private readonly vectorStore: VectorStore
  private readonly embedding: Embedding

  constructor(options: SemanticSearchOptions) {
    this.vectorStore = options.vectorStore
    this.embedding = options.embedding
  }

  /**
   * Index a single document
   */
  async index(document: IndexableDocument): Promise<void> {
    const result = await this.embedding.embed(document.content)
    await this.vectorStore.upsert(document.id, result.vector, {
      text: document.content,
      ...document.metadata,
    })
  }

  /**
   * Index multiple documents in batch
   */
  async indexBatch(documents: IndexableDocument[]): Promise<void> {
    if (documents.length === 0)
      return

    const contents = documents.map(doc => doc.content)
    const embeddingResults = await this.embedding.embedBatch(contents)

    const docs = documents.map((doc, i) => {
      const embeddingResult = embeddingResults[i]
      if (!embeddingResult)
        throw new Error(`Missing embedding result for document ${doc.id}`)
      return {
        id: doc.id,
        embedding: embeddingResult.vector,
        metadata: { text: doc.content, ...doc.metadata },
      }
    })

    if (this.vectorStore.upsertBatch) {
      await this.vectorStore.upsertBatch(docs)
    }
    else {
      await Promise.all(docs.map(d => this.vectorStore.upsert(d.id, d.embedding, d.metadata)))
    }
  }

  /**
   * Search for similar documents using natural language query
   */
  async search(query: string, topK = 10): Promise<SemanticSearchResult[]> {
    const queryEmbedding = await this.embedding.embed(query)
    const results = await this.vectorStore.search(queryEmbedding.vector, { topK })
    return results.map(r => ({
      id: r.id,
      score: r.score,
      content: (r.metadata?.text as string | undefined) ?? '',
      metadata: r.metadata,
    }))
  }

  /**
   * Search using a pre-computed embedding vector
   */
  async searchByVector(queryVector: number[], topK = 10): Promise<SemanticSearchResult[]> {
    const results = await this.vectorStore.search(queryVector, { topK })
    return results.map(r => ({
      id: r.id,
      score: r.score,
      content: (r.metadata?.text as string | undefined) ?? '',
      metadata: r.metadata,
    }))
  }

  /**
   * Hybrid search — delegates to vector search.
   * Note: the injected VectorStore does not support BM25+vector fusion;
   * results are pure cosine similarity. vectorWeight is ignored.
   */
  async searchHybrid(query: string, topK = 10, _vectorWeight = 0.7): Promise<SemanticSearchResult[]> {
    log.debug('searchHybrid: VectorStore does not support hybrid BM25 search; falling back to vector-only')
    return this.search(query, topK)
  }

  /**
   * Full-text search — delegates to vector search.
   * Note: the injected VectorStore does not support BM25 full-text search;
   * results are pure cosine similarity.
   */
  async searchFts(query: string, topK = 10): Promise<SemanticSearchResult[]> {
    log.debug('searchFts: VectorStore does not support full-text search; falling back to vector-only')
    return this.search(query, topK)
  }

  /**
   * Clear all indexed documents
   */
  async clear(): Promise<void> {
    if (this.vectorStore.clear) {
      await this.vectorStore.clear()
    }
  }

  /**
   * Delete documents by ID
   */
  async delete(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.vectorStore.remove(id)
    }
  }

  /**
   * Get number of indexed documents
   */
  async count(): Promise<number> {
    return this.vectorStore.count()
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
