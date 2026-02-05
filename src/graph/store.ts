import type { Edge, EdgeType, Node } from './index'
import type { RPGConfig, SerializedRPG } from './rpg'

/**
 * Filter options for node queries
 */
export interface NodeFilter {
  type?: 'high_level' | 'low_level'
  entityType?: string
  path?: string
}

/**
 * Filter options for edge queries
 */
export interface EdgeFilter {
  type?: EdgeType
  source?: string
  target?: string
}

/**
 * Options for deep graph traversal (ExploreRPG)
 */
export interface TraverseOptions {
  startNode: string
  edgeType: 'functional' | 'dependency' | 'both'
  direction: 'out' | 'in' | 'both'
  maxDepth: number
  entityTypeFilter?: string
  depTypeFilter?: string
}

/**
 * Result of graph traversal
 */
export interface TraverseResult {
  nodes: Node[]
  edges: Array<{ source: string, target: string, type: string, depType?: string }>
  maxDepthReached: number
}

/**
 * Search result with relevance score
 */
export interface SearchHit {
  node: Node
  score: number
}

/**
 * Graph statistics
 */
export interface GraphStats {
  nodeCount: number
  edgeCount: number
  highLevelNodeCount: number
  lowLevelNodeCount: number
  functionalEdgeCount: number
  dependencyEdgeCount: number
}

/**
 * GraphStore - Abstract storage interface for the Repository Planning Graph
 *
 * Provides a unified API for graph CRUD, traversal, search, and persistence.
 * Implementations: SQLiteStore (better-sqlite3), SurrealStore (surrealdb).
 */
export interface GraphStore {
  // ==================== Lifecycle ====================

  /** Open the store (file path for persistence, 'memory' for in-memory) */
  open: (path: string) => Promise<void>

  /** Close the store and release resources */
  close: () => Promise<void>

  // ==================== Node CRUD ====================

  addNode: (node: Node) => Promise<void>
  getNode: (id: string) => Promise<Node | null>
  hasNode: (id: string) => Promise<boolean>
  updateNode: (id: string, updates: Partial<Node>) => Promise<void>
  removeNode: (id: string) => Promise<void>
  getNodes: (filter?: NodeFilter) => Promise<Node[]>

  // ==================== Edge CRUD ====================

  addEdge: (edge: Edge) => Promise<void>
  removeEdge: (source: string, target: string, type: EdgeType) => Promise<void>
  getEdges: (filter?: EdgeFilter) => Promise<Edge[]>
  getOutEdges: (nodeId: string, type?: EdgeType) => Promise<Edge[]>
  getInEdges: (nodeId: string, type?: EdgeType) => Promise<Edge[]>

  // ==================== Graph Navigation ====================

  /** Get children via functional edges (source → target) */
  getChildren: (nodeId: string) => Promise<Node[]>

  /** Get parent via functional edge (target ← source) */
  getParent: (nodeId: string) => Promise<Node | null>

  /** Get dependency targets (this node depends on) */
  getDependencies: (nodeId: string) => Promise<Node[]>

  /** Get dependents (nodes that depend on this node) */
  getDependents: (nodeId: string) => Promise<Node[]>

  // ==================== Deep Traversal (ExploreRPG) ====================

  traverse: (options: TraverseOptions) => Promise<TraverseResult>

  // ==================== Search (SearchNode) ====================

  /** Full-text search on semantic features with optional scope restriction */
  searchByFeature: (query: string, scopes?: string[]) => Promise<SearchHit[]>

  /** Search by file path pattern */
  searchByPath: (pattern: string) => Promise<Node[]>

  // ==================== Ordering ====================

  getTopologicalOrder: () => Promise<Node[]>

  // ==================== Statistics ====================

  getStats: () => Promise<GraphStats>

  // ==================== Serialization (backward compat) ====================

  importJSON: (data: SerializedRPG) => Promise<void>
  exportJSON: (config: RPGConfig) => Promise<SerializedRPG>
}
