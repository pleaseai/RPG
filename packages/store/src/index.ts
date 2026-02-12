export type { ContextStore } from './context-store'
// Store interfaces (generic, domain-agnostic)
export type { GraphStore } from './graph-store'
export type { TextSearchStore } from './text-search-store'
// Shared types
export type {
  ContextStoreConfig,
  EdgeAttrs,
  EdgeFilter,
  Lifecycle,
  NodeAttrs,
  NodeFilter,
  SerializedGraph,
  TextSearchOpts,
  TextSearchResult,
  TraverseOpts,
  TraverseResult,
  VectorSearchOpts,
  VectorSearchResult,
} from './types'

export type { VectorStore } from './vector-store'

// Store implementations — import directly to avoid transitive deps:
//   import { SQLiteGraphStore } from '@pleaseai/rpg-store/sqlite'
//   import { SQLiteTextSearchStore } from '@pleaseai/rpg-store/sqlite'
//   import { SurrealGraphStore } from '@pleaseai/rpg-store/surreal'
//   import { SurrealTextSearchStore } from '@pleaseai/rpg-store/surreal'
//   import { LanceDBVectorStore } from '@pleaseai/rpg-store/lancedb'
