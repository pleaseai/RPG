import type {
  EdgeAttrs,
  EdgeFilter,
  Lifecycle,
  NodeAttrs,
  NodeFilter,
  SerializedGraph,
  TraverseOpts,
  TraverseResult,
} from './types'

/**
 * GraphStore — Pure graph structure storage.
 *
 * Domain-agnostic: stores nodes as (id, attrs) and edges as (source, target, attrs).
 * Edge identity = (source, target, attrs.type).
 */
export interface GraphStore extends Lifecycle {
  // ==================== Node CRUD ====================

  addNode: (id: string, attrs: NodeAttrs) => Promise<void>
  getNode: (id: string) => Promise<NodeAttrs | null>
  hasNode: (id: string) => Promise<boolean>
  updateNode: (id: string, attrs: Partial<NodeAttrs>) => Promise<void>
  removeNode: (id: string) => Promise<void>
  getNodes: (filter?: NodeFilter) => Promise<Array<{ id: string, attrs: NodeAttrs }>>

  // ==================== Edge CRUD ====================

  addEdge: (source: string, target: string, attrs: EdgeAttrs) => Promise<void>
  removeEdge: (source: string, target: string, type: string) => Promise<void>
  getEdges: (
    filter?: EdgeFilter,
  ) => Promise<Array<{ source: string, target: string, attrs: EdgeAttrs }>>

  // ==================== Neighbor Queries ====================

  getNeighbors: (id: string, direction: 'in' | 'out' | 'both', edgeType?: string) => Promise<string[]>

  // ==================== Graph Traversal ====================

  traverse: (startId: string, opts: TraverseOpts) => Promise<TraverseResult>

  // ==================== Subgraph / Serialization ====================

  subgraph: (nodeIds: string[]) => Promise<SerializedGraph>
  export: () => Promise<SerializedGraph>
  import: (data: SerializedGraph) => Promise<void>
}
