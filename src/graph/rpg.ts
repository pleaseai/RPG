import { z } from 'zod'
import {
  type DependencyEdge,
  type Edge,
  EdgeType,
  type FunctionalEdge,
  createDependencyEdge,
  createFunctionalEdge,
  isDependencyEdge,
  isFunctionalEdge,
} from './edge'
import {
  type HighLevelNode,
  type LowLevelNode,
  type Node,
  type SemanticFeature,
  type StructuralMetadata,
  createHighLevelNode,
  createLowLevelNode,
  isHighLevelNode,
  isLowLevelNode,
} from './node'
import type { GraphStats, GraphStore } from './store'

/**
 * Repository Planning Graph configuration
 */
export interface RPGConfig {
  /** Repository name */
  name: string
  /** Repository root path */
  rootPath?: string
  /** Repository description */
  description?: string
}

/**
 * Serialized RPG format for persistence
 */
export const SerializedRPGSchema = z.object({
  version: z.string(),
  config: z.object({
    name: z.string(),
    rootPath: z.string().optional(),
    description: z.string().optional(),
  }),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
})

export type SerializedRPG = z.infer<typeof SerializedRPGSchema>

/**
 * Repository Planning Graph
 *
 * A hierarchical, dual-view graph G = (V, E) that combines:
 * - Nodes: High-level (architectural) and Low-level (implementation)
 * - Edges: Functional (hierarchy) and Dependency (imports/calls)
 *
 * Delegates all storage to a GraphStore backend.
 */
export class RepositoryPlanningGraph {
  private store: GraphStore
  private config: RPGConfig

  constructor(config: RPGConfig, store: GraphStore) {
    this.config = config
    this.store = store
  }

  /**
   * Factory: create an RPG with an optional store (defaults to in-memory SQLiteStore)
   */
  static async create(config: RPGConfig, store?: GraphStore): Promise<RepositoryPlanningGraph> {
    let actualStore = store
    if (!actualStore) {
      const { SQLiteStore } = await import('./sqlite-store')
      actualStore = new SQLiteStore()
      await actualStore.open('memory')
    }
    return new RepositoryPlanningGraph(config, actualStore)
  }

  // ==================== Node Operations ====================

  /**
   * Add a node to the graph
   */
  async addNode(node: Node): Promise<void> {
    if (await this.store.hasNode(node.id)) {
      throw new Error(`Node with id "${node.id}" already exists`)
    }
    await this.store.addNode(node)
  }

  /**
   * Add a high-level node
   */
  async addHighLevelNode(params: {
    id: string
    feature: SemanticFeature
    directoryPath?: string
    metadata?: StructuralMetadata
  }): Promise<HighLevelNode> {
    const node = createHighLevelNode(params)
    await this.addNode(node)
    return node
  }

  /**
   * Add a low-level node
   */
  async addLowLevelNode(params: {
    id: string
    feature: SemanticFeature
    metadata: StructuralMetadata
    sourceCode?: string
  }): Promise<LowLevelNode> {
    const node = createLowLevelNode(params)
    await this.addNode(node)
    return node
  }

  /**
   * Get a node by ID
   */
  async getNode(id: string): Promise<Node | undefined> {
    const node = await this.store.getNode(id)
    return node ?? undefined
  }

  /**
   * Update a node's attributes
   */
  async updateNode(id: string, updates: Partial<Node>): Promise<void> {
    if (!(await this.store.hasNode(id))) {
      throw new Error(`Node with id "${id}" not found`)
    }
    await this.store.updateNode(id, updates)
  }

  /**
   * Remove a node and its associated edges
   */
  async removeNode(id: string): Promise<void> {
    if (!(await this.store.hasNode(id))) {
      throw new Error(`Node with id "${id}" not found`)
    }
    await this.store.removeNode(id)
  }

  /**
   * Check if a node exists
   */
  async hasNode(id: string): Promise<boolean> {
    return this.store.hasNode(id)
  }

  /**
   * Get all nodes
   */
  async getNodes(): Promise<Node[]> {
    return this.store.getNodes()
  }

  /**
   * Get all high-level nodes
   */
  async getHighLevelNodes(): Promise<HighLevelNode[]> {
    const nodes = await this.store.getNodes({ type: 'high_level' })
    return nodes.filter(isHighLevelNode)
  }

  /**
   * Get all low-level nodes
   */
  async getLowLevelNodes(): Promise<LowLevelNode[]> {
    const nodes = await this.store.getNodes({ type: 'low_level' })
    return nodes.filter(isLowLevelNode)
  }

  // ==================== Edge Operations ====================

  /**
   * Add an edge to the graph
   */
  async addEdge(edge: Edge): Promise<void> {
    if (!(await this.store.hasNode(edge.source))) {
      throw new Error(`Source node "${edge.source}" not found`)
    }
    if (!(await this.store.hasNode(edge.target))) {
      throw new Error(`Target node "${edge.target}" not found`)
    }
    await this.store.addEdge(edge)
  }

  /**
   * Add a functional edge (parent-child hierarchy)
   */
  async addFunctionalEdge(params: {
    source: string
    target: string
    level?: number
    siblingOrder?: number
  }): Promise<FunctionalEdge> {
    const edge = createFunctionalEdge(params)
    await this.addEdge(edge)
    return edge
  }

  /**
   * Add a dependency edge (import/call)
   */
  async addDependencyEdge(params: {
    source: string
    target: string
    dependencyType: 'import' | 'call' | 'inherit' | 'implement' | 'use'
    isRuntime?: boolean
    line?: number
  }): Promise<DependencyEdge> {
    const edge = createDependencyEdge(params)
    await this.addEdge(edge)
    return edge
  }

  /**
   * Get all edges
   */
  async getEdges(): Promise<Edge[]> {
    return this.store.getEdges()
  }

  /**
   * Get functional edges only
   */
  async getFunctionalEdges(): Promise<FunctionalEdge[]> {
    const edges = await this.store.getEdges({ type: EdgeType.Functional })
    return edges.filter(isFunctionalEdge)
  }

  /**
   * Get dependency edges only
   */
  async getDependencyEdges(): Promise<DependencyEdge[]> {
    const edges = await this.store.getEdges({ type: EdgeType.Dependency })
    return edges.filter(isDependencyEdge)
  }

  /**
   * Get outgoing edges from a node
   */
  async getOutEdges(nodeId: string, edgeType?: EdgeType): Promise<Edge[]> {
    return this.store.getOutEdges(nodeId, edgeType)
  }

  /**
   * Get incoming edges to a node
   */
  async getInEdges(nodeId: string, edgeType?: EdgeType): Promise<Edge[]> {
    return this.store.getInEdges(nodeId, edgeType)
  }

  /**
   * Get children of a node (via functional edges)
   */
  async getChildren(nodeId: string): Promise<Node[]> {
    return this.store.getChildren(nodeId)
  }

  /**
   * Get parent of a node (via functional edges)
   */
  async getParent(nodeId: string): Promise<Node | undefined> {
    const parent = await this.store.getParent(nodeId)
    return parent ?? undefined
  }

  /**
   * Get dependencies of a node (via dependency edges)
   */
  async getDependencies(nodeId: string): Promise<Node[]> {
    return this.store.getDependencies(nodeId)
  }

  /**
   * Get dependents of a node (nodes that depend on this node)
   */
  async getDependents(nodeId: string): Promise<Node[]> {
    return this.store.getDependents(nodeId)
  }

  // ==================== Graph Operations ====================

  /**
   * Get topological order of nodes (respecting dependencies)
   */
  async getTopologicalOrder(): Promise<Node[]> {
    return this.store.getTopologicalOrder()
  }

  /**
   * Find nodes by semantic feature search
   */
  async searchByFeature(query: string): Promise<Node[]> {
    const hits = await this.store.searchByFeature(query)
    return hits.map((h) => h.node)
  }

  /**
   * Find nodes by file path pattern
   */
  async searchByPath(pattern: string): Promise<Node[]> {
    return this.store.searchByPath(pattern)
  }

  // ==================== Serialization ====================

  /**
   * Serialize the graph for persistence
   */
  async serialize(): Promise<SerializedRPG> {
    return this.store.exportJSON(this.config)
  }

  /**
   * Export to JSON string
   */
  async toJSON(): Promise<string> {
    const data = await this.serialize()
    return JSON.stringify(data, null, 2)
  }

  /**
   * Create an RPG from serialized data
   */
  static async deserialize(
    data: SerializedRPG,
    store?: GraphStore
  ): Promise<RepositoryPlanningGraph> {
    const parsed = SerializedRPGSchema.parse(data)
    const rpg = await RepositoryPlanningGraph.create(parsed.config, store)
    await rpg.store.importJSON(parsed)
    return rpg
  }

  /**
   * Create an RPG from JSON string
   */
  static async fromJSON(json: string, store?: GraphStore): Promise<RepositoryPlanningGraph> {
    return RepositoryPlanningGraph.deserialize(JSON.parse(json), store)
  }

  // ==================== Statistics ====================

  /**
   * Get graph statistics
   */
  async getStats(): Promise<GraphStats> {
    return this.store.getStats()
  }

  /**
   * Get the repository configuration
   */
  getConfig(): RPGConfig {
    return { ...this.config }
  }

  /**
   * Close the store and release resources
   */
  async close(): Promise<void> {
    await this.store.close()
  }
}
