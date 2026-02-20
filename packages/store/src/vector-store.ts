import type { Lifecycle, VectorSearchOpts, VectorSearchResult } from './types'

/**
 * VectorStore — Embedding-based similarity search.
 */
export interface VectorStore extends Lifecycle {
  /** Upsert a single embedding */
  upsert: (id: string, embedding: number[], metadata?: Record<string, unknown>) => Promise<void>

  /** Remove an embedding by ID */
  remove: (id: string) => Promise<void>

  /** Search by vector similarity */
  search: (query: number[], opts?: VectorSearchOpts) => Promise<VectorSearchResult[]>

  /** Batch upsert embeddings */
  upsertBatch?: (
    docs: Array<{ id: string, embedding: number[], metadata?: Record<string, unknown> }>,
  ) => Promise<void>

  /** Count indexed embeddings */
  count: () => Promise<number>

  /** Clear all indexed embeddings */
  clear?: () => Promise<void>
}
