import Graph from 'graphology'
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
 */
export class RepositoryPlanningGraph {
  private graph: Graph
  private config: RPGConfig

  constructor(config: RPGConfig) {
    this.config = config
    this.graph = new Graph({ multi: true, type: 'directed' })
  }

  // ==================== Node Operations ====================

  /**
   * Add a node to the graph
   */
  addNode(node: Node): void {
    if (this.graph.hasNode(node.id)) {
      throw new Error(`Node with id "${node.id}" already exists`)
    }
    this.graph.addNode(node.id, node)
  }

  /**
   * Add a high-level node
   */
  addHighLevelNode(params: {
    id: string
    feature: SemanticFeature
    directoryPath?: string
    metadata?: StructuralMetadata
  }): HighLevelNode {
    const node = createHighLevelNode(params)
    this.addNode(node)
    return node
  }

  /**
   * Add a low-level node
   */
  addLowLevelNode(params: {
    id: string
    feature: SemanticFeature
    metadata: StructuralMetadata
    sourceCode?: string
  }): LowLevelNode {
    const node = createLowLevelNode(params)
    this.addNode(node)
    return node
  }

  /**
   * Get a node by ID
   */
  getNode(id: string): Node | undefined {
    if (!this.graph.hasNode(id)) {
      return undefined
    }
    return this.graph.getNodeAttributes(id) as Node
  }

  /**
   * Update a node's attributes
   */
  updateNode(id: string, updates: Partial<Node>): void {
    if (!this.graph.hasNode(id)) {
      throw new Error(`Node with id "${id}" not found`)
    }
    this.graph.mergeNodeAttributes(id, updates)
  }

  /**
   * Remove a node and its associated edges
   */
  removeNode(id: string): void {
    if (!this.graph.hasNode(id)) {
      throw new Error(`Node with id "${id}" not found`)
    }
    this.graph.dropNode(id)
  }

  /**
   * Check if a node exists
   */
  hasNode(id: string): boolean {
    return this.graph.hasNode(id)
  }

  /**
   * Get all nodes
   */
  getNodes(): Node[] {
    return this.graph.mapNodes((_id, attrs) => attrs as Node)
  }

  /**
   * Get all high-level nodes
   */
  getHighLevelNodes(): HighLevelNode[] {
    return this.getNodes().filter(isHighLevelNode)
  }

  /**
   * Get all low-level nodes
   */
  getLowLevelNodes(): LowLevelNode[] {
    return this.getNodes().filter(isLowLevelNode)
  }

  // ==================== Edge Operations ====================

  /**
   * Add an edge to the graph
   */
  addEdge(edge: Edge): void {
    if (!this.graph.hasNode(edge.source)) {
      throw new Error(`Source node "${edge.source}" not found`)
    }
    if (!this.graph.hasNode(edge.target)) {
      throw new Error(`Target node "${edge.target}" not found`)
    }

    const edgeKey = `${edge.source}->${edge.target}:${edge.type}`
    this.graph.addEdgeWithKey(edgeKey, edge.source, edge.target, edge)
  }

  /**
   * Add a functional edge (parent-child hierarchy)
   */
  addFunctionalEdge(params: {
    source: string
    target: string
    level?: number
    siblingOrder?: number
  }): FunctionalEdge {
    const edge = createFunctionalEdge(params)
    this.addEdge(edge)
    return edge
  }

  /**
   * Add a dependency edge (import/call)
   */
  addDependencyEdge(params: {
    source: string
    target: string
    dependencyType: 'import' | 'call' | 'inherit' | 'implement' | 'use'
    isRuntime?: boolean
    line?: number
  }): DependencyEdge {
    const edge = createDependencyEdge(params)
    this.addEdge(edge)
    return edge
  }

  /**
   * Get all edges
   */
  getEdges(): Edge[] {
    return this.graph.mapEdges((_edge, attrs) => attrs as Edge)
  }

  /**
   * Get functional edges only
   */
  getFunctionalEdges(): FunctionalEdge[] {
    return this.getEdges().filter(isFunctionalEdge)
  }

  /**
   * Get dependency edges only
   */
  getDependencyEdges(): DependencyEdge[] {
    return this.getEdges().filter(isDependencyEdge)
  }

  /**
   * Get outgoing edges from a node
   */
  getOutEdges(nodeId: string, edgeType?: EdgeType): Edge[] {
    if (!this.graph.hasNode(nodeId)) {
      return []
    }
    const edges = this.graph.mapOutEdges(nodeId, (_edge, attrs) => attrs as Edge)
    if (edgeType) {
      return edges.filter((e) => e.type === edgeType)
    }
    return edges
  }

  /**
   * Get incoming edges to a node
   */
  getInEdges(nodeId: string, edgeType?: EdgeType): Edge[] {
    if (!this.graph.hasNode(nodeId)) {
      return []
    }
    const edges = this.graph.mapInEdges(nodeId, (_edge, attrs) => attrs as Edge)
    if (edgeType) {
      return edges.filter((e) => e.type === edgeType)
    }
    return edges
  }

  /**
   * Get children of a node (via functional edges)
   */
  getChildren(nodeId: string): Node[] {
    const edges = this.getOutEdges(nodeId, EdgeType.Functional)
    return edges.map((e) => this.getNode(e.target)).filter((n): n is Node => n !== undefined)
  }

  /**
   * Get parent of a node (via functional edges)
   */
  getParent(nodeId: string): Node | undefined {
    const edges = this.getInEdges(nodeId, EdgeType.Functional)
    const firstEdge = edges[0]
    if (!firstEdge) return undefined
    return this.getNode(firstEdge.source)
  }

  /**
   * Get dependencies of a node (via dependency edges)
   */
  getDependencies(nodeId: string): Node[] {
    const edges = this.getOutEdges(nodeId, EdgeType.Dependency)
    return edges.map((e) => this.getNode(e.target)).filter((n): n is Node => n !== undefined)
  }

  /**
   * Get dependents of a node (nodes that depend on this node)
   */
  getDependents(nodeId: string): Node[] {
    const edges = this.getInEdges(nodeId, EdgeType.Dependency)
    return edges.map((e) => this.getNode(e.source)).filter((n): n is Node => n !== undefined)
  }

  // ==================== Graph Operations ====================

  /**
   * Get topological order of nodes (respecting dependencies)
   */
  getTopologicalOrder(): Node[] {
    const visited = new Set<string>()
    const result: Node[] = []

    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return
      visited.add(nodeId)

      // Visit dependencies first
      const deps = this.getOutEdges(nodeId, EdgeType.Dependency)
      for (const dep of deps) {
        visit(dep.target)
      }

      const node = this.getNode(nodeId)
      if (node) result.push(node)
    }

    for (const node of this.getNodes()) {
      visit(node.id)
    }

    return result.reverse()
  }

  /**
   * Find nodes by semantic feature search
   */
  searchByFeature(query: string): Node[] {
    const queryLower = query.toLowerCase()
    return this.getNodes().filter((node) => {
      const desc = node.feature.description.toLowerCase()
      const keywords = node.feature.keywords?.map((k) => k.toLowerCase()) ?? []
      const subFeatures = node.feature.subFeatures?.map((f) => f.toLowerCase()) ?? []

      return (
        desc.includes(queryLower) ||
        keywords.some((k) => k.includes(queryLower)) ||
        subFeatures.some((f) => f.includes(queryLower))
      )
    })
  }

  /**
   * Find nodes by file path pattern
   */
  searchByPath(pattern: string): Node[] {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'))
    return this.getLowLevelNodes().filter((node) => {
      const path = node.metadata?.path
      return path && regex.test(path)
    })
  }

  // ==================== Serialization ====================

  /**
   * Serialize the graph for persistence
   */
  serialize(): SerializedRPG {
    return {
      version: '1.0.0',
      config: this.config,
      nodes: this.getNodes(),
      edges: this.getEdges(),
    }
  }

  /**
   * Export to JSON string
   */
  toJSON(): string {
    return JSON.stringify(this.serialize(), null, 2)
  }

  /**
   * Create an RPG from serialized data
   */
  static deserialize(data: SerializedRPG): RepositoryPlanningGraph {
    const parsed = SerializedRPGSchema.parse(data)
    const rpg = new RepositoryPlanningGraph(parsed.config)

    for (const nodeData of parsed.nodes) {
      rpg.addNode(nodeData as Node)
    }

    for (const edgeData of parsed.edges) {
      rpg.addEdge(edgeData as Edge)
    }

    return rpg
  }

  /**
   * Create an RPG from JSON string
   */
  static fromJSON(json: string): RepositoryPlanningGraph {
    return RepositoryPlanningGraph.deserialize(JSON.parse(json))
  }

  // ==================== Statistics ====================

  /**
   * Get graph statistics
   */
  getStats(): {
    nodeCount: number
    edgeCount: number
    highLevelNodeCount: number
    lowLevelNodeCount: number
    functionalEdgeCount: number
    dependencyEdgeCount: number
  } {
    return {
      nodeCount: this.graph.order,
      edgeCount: this.graph.size,
      highLevelNodeCount: this.getHighLevelNodes().length,
      lowLevelNodeCount: this.getLowLevelNodes().length,
      functionalEdgeCount: this.getFunctionalEdges().length,
      dependencyEdgeCount: this.getDependencyEdges().length,
    }
  }

  /**
   * Get the repository configuration
   */
  getConfig(): RPGConfig {
    return { ...this.config }
  }
}
