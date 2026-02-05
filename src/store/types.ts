/**
 * Generic attribute types for store layer.
 * Domain-agnostic — RPG-specific types live in src/graph/adapters.ts.
 */

/** Generic node attributes stored as a flat record */
export type NodeAttrs = Record<string, unknown>

/**
 * Generic edge attributes. The `type` field is part of edge identity:
 * edge identity = (source, target, type).
 */
export type EdgeAttrs = Record<string, unknown> & { type: string }

/** Serialized graph for import/export and subgraph extraction */
export interface SerializedGraph {
  nodes: Array<{ id: string, attrs: NodeAttrs }>
  edges: Array<{ source: string, target: string, attrs: EdgeAttrs }>
}

/** Filter for node queries */
export interface NodeFilter {
  [key: string]: unknown
}

/** Filter for edge queries */
export interface EdgeFilter {
  source?: string
  target?: string
  type?: string
}

/** Options for graph traversal */
export interface TraverseOpts {
  direction: 'in' | 'out' | 'both'
  edgeType?: string
  maxDepth: number
  filter?: Record<string, unknown>
}

/** Result of graph traversal */
export interface TraverseResult {
  nodes: Array<{ id: string, attrs: NodeAttrs }>
  edges: Array<{ source: string, target: string, attrs: EdgeAttrs }>
  maxDepthReached: number
}

/** Options for vector search */
export interface VectorSearchOpts {
  topK?: number
  filter?: Record<string, unknown>
}

/** Result of vector search */
export interface VectorSearchResult {
  id: string
  score: number
  metadata?: Record<string, unknown>
}

/** Options for text search */
export interface TextSearchOpts {
  topK?: number
  fields?: string[]
}

/** Result of text search */
export interface TextSearchResult {
  id: string
  score: number
  fields?: Record<string, string>
}

/** Lifecycle interface for stores that need explicit open/close */
export interface Lifecycle {
  open: (config: unknown) => Promise<void>
  close: () => Promise<void>
}

/** Configuration for ContextStore */
export interface ContextStoreConfig {
  /** 'memory' for in-memory, otherwise a file/directory path */
  path: string
  /** Optional vector store DB path (defaults to path + '/vectors') */
  vectorPath?: string
}
