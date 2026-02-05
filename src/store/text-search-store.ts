import type { Lifecycle, TextSearchOpts, TextSearchResult } from './types'

/**
 * TextSearchStore — Full-text / BM25 search.
 *
 * Indexes documents by multiple text fields. Supports field-restricted search.
 */
export interface TextSearchStore extends Lifecycle {
  /** Index a document for text search */
  index: (
    id: string,
    fields: Record<string, string>,
    metadata?: Record<string, unknown>,
  ) => Promise<void>

  /** Remove a document from the index */
  remove: (id: string) => Promise<void>

  /** Search indexed documents */
  search: (query: string, opts?: TextSearchOpts) => Promise<TextSearchResult[]>

  /** Batch index documents */
  indexBatch?: (docs: Array<{ id: string, fields: Record<string, string> }>) => Promise<void>
}
