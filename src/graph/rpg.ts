import type { ContextStore } from '../store/context-store'
import type { DependencyEdge, Edge, FunctionalEdge } from './edge'
import type { HighLevelNode, LowLevelNode, Node, SemanticFeature, StructuralMetadata } from './node'
import type { GraphStats, GraphStore } from './store'
import { z } from 'zod'
import { attrsToEdge, attrsToNode, edgeToAttrs, nodeToAttrs, nodeToSearchFields } from './adapters'
import {
  createDependencyEdge,
  createFunctionalEdge,

  EdgeType,

  isDependencyEdge,
  isFunctionalEdge,
} from './edge'
import {
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
 *
 * Delegates storage to a ContextStore (graph + text + vector).
 * Also supports legacy GraphStore for backward compatibility.
 */
export class RepositoryPlanningGraph {
  private context: ContextStore | null = null
  private legacyStore: GraphStore | null = null
  private config: RPGConfig

  constructor(config: RPGConfig, storeOrContext: GraphStore | ContextStore) {
    this.config = config
    if (isContextStore(storeOrContext)) {
      this.context = storeOrContext
    }
    else {
      this.legacyStore = storeOrContext
    }
  }

  /**
   * Factory: create an RPG with an optional store/context.
   * Defaults to legacy SQLiteStore (better-sqlite3) for backward compatibility.
   * Pass a ContextStore explicitly to use the new decomposed store layer.
   */
  static async create(
    config: RPGConfig,
    storeOrContext?: GraphStore | ContextStore,
  ): Promise<RepositoryPlanningGraph> {
    if (storeOrContext) {
      return new RepositoryPlanningGraph(config, storeOrContext)
    }
    // Default: use legacy SQLiteStore for backward compatibility
    const { SQLiteStore } = await import('./sqlite-store')
    const store = new SQLiteStore()
    await store.open('memory')
    return new RepositoryPlanningGraph(config, store)
  }

  // ==================== Internal Accessors ====================

  private get isNewStore(): boolean {
    return this.context !== null
  }

  // ==================== Node Operations ====================

  async addNode(node: Node): Promise<void> {
    if (this.isNewStore) {
      if (await this.context!.graph.hasNode(node.id)) {
        throw new Error(`Node with id "${node.id}" already exists`)
      }
      await this.context!.graph.addNode(node.id, nodeToAttrs(node))
      await this.context!.text.index(node.id, nodeToSearchFields(node))
    }
    else {
      if (await this.legacyStore!.hasNode(node.id)) {
        throw new Error(`Node with id "${node.id}" already exists`)
      }
      await this.legacyStore!.addNode(node)
    }
  }

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

  async getNode(id: string): Promise<Node | undefined> {
    if (this.isNewStore) {
      const attrs = await this.context!.graph.getNode(id)
      return attrs ? attrsToNode(id, attrs) : undefined
    }
    const node = await this.legacyStore!.getNode(id)
    return node ?? undefined
  }

  async updateNode(id: string, updates: Partial<Node>): Promise<void> {
    if (this.isNewStore) {
      if (!(await this.context!.graph.hasNode(id))) {
        throw new Error(`Node with id "${id}" not found`)
      }
      // Merge updates into existing attrs
      const existing = await this.context!.graph.getNode(id)
      if (!existing)
        return
      const mergedNode = { ...attrsToNode(id, existing), ...updates } as Node
      await this.context!.graph.updateNode(id, nodeToAttrs(mergedNode))
      await this.context!.text.index(id, nodeToSearchFields(mergedNode))
    }
    else {
      if (!(await this.legacyStore!.hasNode(id))) {
        throw new Error(`Node with id "${id}" not found`)
      }
      await this.legacyStore!.updateNode(id, updates)
    }
  }

  async removeNode(id: string): Promise<void> {
    if (this.isNewStore) {
      if (!(await this.context!.graph.hasNode(id))) {
        throw new Error(`Node with id "${id}" not found`)
      }
      await this.context!.graph.removeNode(id)
      await this.context!.text.remove(id)
    }
    else {
      if (!(await this.legacyStore!.hasNode(id))) {
        throw new Error(`Node with id "${id}" not found`)
      }
      await this.legacyStore!.removeNode(id)
    }
  }

  async hasNode(id: string): Promise<boolean> {
    if (this.isNewStore) {
      return this.context!.graph.hasNode(id)
    }
    return this.legacyStore!.hasNode(id)
  }

  async getNodes(): Promise<Node[]> {
    if (this.isNewStore) {
      const results = await this.context!.graph.getNodes()
      return results.map(r => attrsToNode(r.id, r.attrs))
    }
    return this.legacyStore!.getNodes()
  }

  async getHighLevelNodes(): Promise<HighLevelNode[]> {
    if (this.isNewStore) {
      const results = await this.context!.graph.getNodes({ type: 'high_level' })
      return results.map(r => attrsToNode(r.id, r.attrs)).filter(isHighLevelNode)
    }
    const nodes = await this.legacyStore!.getNodes({ type: 'high_level' })
    return nodes.filter(isHighLevelNode)
  }

  async getLowLevelNodes(): Promise<LowLevelNode[]> {
    if (this.isNewStore) {
      const results = await this.context!.graph.getNodes({ type: 'low_level' })
      return results.map(r => attrsToNode(r.id, r.attrs)).filter(isLowLevelNode)
    }
    const nodes = await this.legacyStore!.getNodes({ type: 'low_level' })
    return nodes.filter(isLowLevelNode)
  }

  // ==================== Edge Operations ====================

  async addEdge(edge: Edge): Promise<void> {
    if (this.isNewStore) {
      if (!(await this.context!.graph.hasNode(edge.source))) {
        throw new Error(`Source node "${edge.source}" not found`)
      }
      if (!(await this.context!.graph.hasNode(edge.target))) {
        throw new Error(`Target node "${edge.target}" not found`)
      }
      await this.context!.graph.addEdge(edge.source, edge.target, edgeToAttrs(edge))
    }
    else {
      if (!(await this.legacyStore!.hasNode(edge.source))) {
        throw new Error(`Source node "${edge.source}" not found`)
      }
      if (!(await this.legacyStore!.hasNode(edge.target))) {
        throw new Error(`Target node "${edge.target}" not found`)
      }
      await this.legacyStore!.addEdge(edge)
    }
  }

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

  async getEdges(): Promise<Edge[]> {
    if (this.isNewStore) {
      const results = await this.context!.graph.getEdges()
      return results.map(r => attrsToEdge(r.source, r.target, r.attrs))
    }
    return this.legacyStore!.getEdges()
  }

  async getFunctionalEdges(): Promise<FunctionalEdge[]> {
    if (this.isNewStore) {
      const results = await this.context!.graph.getEdges({ type: 'functional' })
      return results.map(r => attrsToEdge(r.source, r.target, r.attrs)).filter(isFunctionalEdge)
    }
    const edges = await this.legacyStore!.getEdges({ type: EdgeType.Functional })
    return edges.filter(isFunctionalEdge)
  }

  async getDependencyEdges(): Promise<DependencyEdge[]> {
    if (this.isNewStore) {
      const results = await this.context!.graph.getEdges({ type: 'dependency' })
      return results.map(r => attrsToEdge(r.source, r.target, r.attrs)).filter(isDependencyEdge)
    }
    const edges = await this.legacyStore!.getEdges({ type: EdgeType.Dependency })
    return edges.filter(isDependencyEdge)
  }

  async getOutEdges(nodeId: string, edgeType?: EdgeType): Promise<Edge[]> {
    if (this.isNewStore) {
      const results = await this.context!.graph.getEdges({ source: nodeId, type: edgeType })
      return results.map(r => attrsToEdge(r.source, r.target, r.attrs))
    }
    return this.legacyStore!.getOutEdges(nodeId, edgeType)
  }

  async getInEdges(nodeId: string, edgeType?: EdgeType): Promise<Edge[]> {
    if (this.isNewStore) {
      const results = await this.context!.graph.getEdges({ target: nodeId, type: edgeType })
      return results.map(r => attrsToEdge(r.source, r.target, r.attrs))
    }
    return this.legacyStore!.getInEdges(nodeId, edgeType)
  }

  async getChildren(nodeId: string): Promise<Node[]> {
    if (this.isNewStore) {
      // Get functional edges from this node, then fetch target nodes
      const edges = await this.context!.graph.getEdges({ source: nodeId, type: 'functional' })
      // Sort by sibling_order
      edges.sort(
        (a, b) =>
          ((a.attrs.sibling_order as number) ?? 0) - ((b.attrs.sibling_order as number) ?? 0),
      )
      const children: Node[] = []
      for (const edge of edges) {
        const attrs = await this.context!.graph.getNode(edge.target)
        if (attrs)
          children.push(attrsToNode(edge.target, attrs))
      }
      return children
    }
    return this.legacyStore!.getChildren(nodeId)
  }

  async getParent(nodeId: string): Promise<Node | undefined> {
    if (this.isNewStore) {
      const edges = await this.context!.graph.getEdges({ target: nodeId, type: 'functional' })
      const firstEdge = edges[0]
      if (!firstEdge)
        return undefined
      const attrs = await this.context!.graph.getNode(firstEdge.source)
      return attrs ? attrsToNode(firstEdge.source, attrs) : undefined
    }
    const parent = await this.legacyStore!.getParent(nodeId)
    return parent ?? undefined
  }

  async getDependencies(nodeId: string): Promise<Node[]> {
    if (this.isNewStore) {
      const edges = await this.context!.graph.getEdges({ source: nodeId, type: 'dependency' })
      const nodes: Node[] = []
      for (const edge of edges) {
        const attrs = await this.context!.graph.getNode(edge.target)
        if (attrs)
          nodes.push(attrsToNode(edge.target, attrs))
      }
      return nodes
    }
    return this.legacyStore!.getDependencies(nodeId)
  }

  async getDependents(nodeId: string): Promise<Node[]> {
    if (this.isNewStore) {
      const edges = await this.context!.graph.getEdges({ target: nodeId, type: 'dependency' })
      const nodes: Node[] = []
      for (const edge of edges) {
        const attrs = await this.context!.graph.getNode(edge.source)
        if (attrs)
          nodes.push(attrsToNode(edge.source, attrs))
      }
      return nodes
    }
    return this.legacyStore!.getDependents(nodeId)
  }

  // ==================== Graph Operations ====================

  async getTopologicalOrder(): Promise<Node[]> {
    if (this.isNewStore) {
      // Kahn's algorithm at RPG layer
      const allNodes = await this.context!.graph.getNodes()
      const depEdges = await this.context!.graph.getEdges({ type: 'dependency' })

      const inDegree = new Map<string, number>()
      const adjList = new Map<string, string[]>()

      for (const { id } of allNodes) {
        inDegree.set(id, 0)
        adjList.set(id, [])
      }

      for (const edge of depEdges) {
        inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
        adjList.get(edge.source)?.push(edge.target)
      }

      const queue: string[] = []
      for (const [id, deg] of inDegree) {
        if (deg === 0)
          queue.push(id)
      }

      const nodeMap = new Map(allNodes.map(r => [r.id, attrsToNode(r.id, r.attrs)]))
      const ordered: Node[] = []

      while (queue.length > 0) {
        const nodeId = queue.shift()!
        const node = nodeMap.get(nodeId)
        if (node)
          ordered.push(node)

        for (const neighbor of adjList.get(nodeId) ?? []) {
          const newDeg = (inDegree.get(neighbor) ?? 1) - 1
          inDegree.set(neighbor, newDeg)
          if (newDeg === 0)
            queue.push(neighbor)
        }
      }

      return ordered
    }
    return this.legacyStore!.getTopologicalOrder()
  }

  async searchByFeature(query: string, scopes?: string[]): Promise<Node[]> {
    if (this.isNewStore) {
      if (scopes && scopes.length > 0) {
        // Collect subtree IDs via BFS on functional edges
        const subtreeIds = new Set<string>()
        const bfsQueue = [...scopes]
        while (bfsQueue.length > 0) {
          const current = bfsQueue.shift()!
          if (subtreeIds.has(current))
            continue
          subtreeIds.add(current)
          const childEdges = await this.context!.graph.getEdges({
            source: current,
            type: 'functional',
          })
          for (const e of childEdges) {
            if (!subtreeIds.has(e.target))
              bfsQueue.push(e.target)
          }
        }

        // Text search then filter by subtree
        const hits = await this.context!.text.search(query, {
          fields: ['feature_desc', 'feature_keywords'],
        })
        const filteredHits = hits.filter(h => subtreeIds.has(h.id))
        const nodes: Node[] = []
        for (const hit of filteredHits) {
          const attrs = await this.context!.graph.getNode(hit.id)
          if (attrs)
            nodes.push(attrsToNode(hit.id, attrs))
        }
        return nodes
      }

      const hits = await this.context!.text.search(query, {
        fields: ['feature_desc', 'feature_keywords'],
      })
      const nodes: Node[] = []
      for (const hit of hits) {
        const attrs = await this.context!.graph.getNode(hit.id)
        if (attrs)
          nodes.push(attrsToNode(hit.id, attrs))
      }
      return nodes
    }
    const hits = await this.legacyStore!.searchByFeature(query, scopes)
    return hits.map(h => h.node)
  }

  async searchByPath(pattern: string): Promise<Node[]> {
    if (this.isNewStore) {
      // Path search uses glob/regex matching, not FTS
      const allNodes = await this.context!.graph.getNodes()
      // Convert pattern: preserve existing .* regex, escape special chars,
      // then convert SQL LIKE % and glob * to .*
      const placeholder = '<<DOTSTAR>>'
      const regexStr = pattern
        .replace(/\.\*/g, placeholder) // preserve existing .* patterns
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/%/g, '.*') // SQL LIKE % → regex .*
        .replace(/\*/g, '.*') // glob * → regex .*
        .replaceAll(placeholder, '.*') // restore preserved .* patterns
      const regex = new RegExp(regexStr)
      return allNodes
        .filter((r) => {
          const path = r.attrs.path as string | undefined
          return path && regex.test(path)
        })
        .map(r => attrsToNode(r.id, r.attrs))
    }
    return this.legacyStore!.searchByPath(pattern)
  }

  // ==================== Serialization ====================

  async serialize(): Promise<SerializedRPG> {
    if (this.isNewStore) {
      const nodes = await this.getNodes()
      const edges = await this.getEdges()
      return {
        version: '1.0.0',
        config: this.config,
        nodes,
        edges,
      }
    }
    return this.legacyStore!.exportJSON(this.config)
  }

  async toJSON(): Promise<string> {
    const data = await this.serialize()
    return JSON.stringify(data, null, 2)
  }

  static async deserialize(
    data: SerializedRPG,
    storeOrContext?: GraphStore | ContextStore,
  ): Promise<RepositoryPlanningGraph> {
    const parsed = SerializedRPGSchema.parse(data)
    const rpg = await RepositoryPlanningGraph.create(parsed.config, storeOrContext)

    // Import nodes and edges
    for (const nodeData of parsed.nodes) {
      const node = nodeData as Node
      await rpg.addNode(node)
    }
    for (const edgeData of parsed.edges) {
      const edge = edgeData as Edge
      await rpg.addEdge(edge)
    }

    return rpg
  }

  static async fromJSON(
    json: string,
    storeOrContext?: GraphStore | ContextStore,
  ): Promise<RepositoryPlanningGraph> {
    return RepositoryPlanningGraph.deserialize(JSON.parse(json), storeOrContext)
  }

  // ==================== Statistics ====================

  async getStats(): Promise<GraphStats> {
    if (this.isNewStore) {
      const allNodes = await this.context!.graph.getNodes()
      const allEdges = await this.context!.graph.getEdges()

      let highLevelCount = 0
      let lowLevelCount = 0
      for (const { attrs } of allNodes) {
        if (attrs.type === 'high_level')
          highLevelCount++
        else if (attrs.type === 'low_level')
          lowLevelCount++
      }

      let functionalCount = 0
      let dependencyCount = 0
      for (const { attrs } of allEdges) {
        if (attrs.type === 'functional')
          functionalCount++
        else if (attrs.type === 'dependency')
          dependencyCount++
      }

      return {
        nodeCount: allNodes.length,
        edgeCount: allEdges.length,
        highLevelNodeCount: highLevelCount,
        lowLevelNodeCount: lowLevelCount,
        functionalEdgeCount: functionalCount,
        dependencyEdgeCount: dependencyCount,
      }
    }
    return this.legacyStore!.getStats()
  }

  getConfig(): RPGConfig {
    return { ...this.config }
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close()
    }
    else if (this.legacyStore) {
      await this.legacyStore.close()
    }
  }
}

/** Type guard: distinguish ContextStore from legacy GraphStore */
function isContextStore(obj: unknown): obj is ContextStore {
  return (
    obj !== null
    && typeof obj === 'object'
    && 'graph' in (obj as Record<string, unknown>)
    && 'text' in (obj as Record<string, unknown>)
    && 'vector' in (obj as Record<string, unknown>)
  )
}
