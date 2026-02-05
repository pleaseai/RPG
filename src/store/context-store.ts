import type { GraphStore } from './graph-store'
import type { TextSearchStore } from './text-search-store'
import type { ContextStoreConfig } from './types'
import type { VectorStore } from './vector-store'

/**
 * ContextStore — Composition of GraphStore + TextSearchStore + VectorStore.
 *
 * Orchestrates lifecycle (open/close) for all sub-stores and provides
 * a single entry point for consumers.
 */
export interface ContextStore {
  readonly graph: GraphStore
  readonly text: TextSearchStore
  readonly vector: VectorStore

  /** Open all sub-stores */
  open: (config: ContextStoreConfig) => Promise<void>

  /** Close all sub-stores */
  close: () => Promise<void>
}
