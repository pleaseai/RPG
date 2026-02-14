import type { ContextStore } from '@pleaseai/rpg-store/context-store'
import type { DataFlowEdge, DependencyEdge, Edge, EdgeType, FunctionalEdge } from './edge'
import type { HighLevelNode, LowLevelNode, Node, SemanticFeature, StructuralMetadata } from './node'
import { createLogger } from '@pleaseai/rpg-utils/logger'
import { z } from 'zod/v4'
import { attrsToEdge, attrsToNode, edgeToAttrs, nodeToAttrs, nodeToSearchFields } from './adapters'
import {
  createDataFlowEdge,
  createDependencyEdge,
  createFunctionalEdge,
  DataFlowEdgeSchema,

  isDependencyEdge,
  isFunctionalEdge,
} from './edge'
import {
  createHighLevelNode,
  createLowLevelNode,

  isHighLevelNode,
  isLowLevelNode,

} from './node'

const log = createLogger('RPG')

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
  dataFlowEdgeCount?: number
}

/**
 * Repository Planning Graph configuration
 */
/**
 * GitHub repository reference for remote source resolution
 */
export interface GitHubSource {
  owner: string
  repo: string
  commit: string
  /** Path prefix within monorepo (e.g., "packages/next") */
  pathPrefix?: string
}

export interface RPGConfig {
  /** Repository name */
  name: string
  /** Repository root path (for filesystem mode) */
  rootPath?: string
  /** Repository description */
  description?: string
  /** GitHub source reference (for github mode) */
  github?: GitHubSource
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
    github: z.object({
      owner: z.string(),
      repo: z.string(),
      commit: z.string(),
      pathPrefix: z.string().optional(),
    }).optional(),
  }),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
  dataFlowEdges: z.array(z.unknown()).optional(),
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
 */
export class RepositoryPlanningGraph {
  private readonly context: ContextStore
  private readonly config: RPGConfig
  private readonly dataFlowEdges: DataFlowEdge[] = []

  constructor(config: RPGConfig, context: ContextStore) {
    this.config = config
    this.context = context
  }

  /**
   * Factory: create an RPG with an optional ContextStore.
   * Defaults to DefaultContextStore (SQLite + LanceDB) when no store is provided.
   */
  static async create(
    config: RPGConfig,
    context?: ContextStore,
  ): Promise<RepositoryPlanningGraph> {
    if (context) {
      return new RepositoryPlanningGraph(config, context)
    }
    const { DefaultContextStore } = await import('@pleaseai/rpg-store/default-context-store')
    const store = new DefaultContextStore()
    await store.open({ path: 'memory' })
    return new RepositoryPlanningGraph(config, store)
  }

  // ==================== Node Operations ====================

  async addNode(node: Node): Promise<void> {
    if (await this.context.graph.hasNode(node.id)) {
      throw new Error(`Node with id "${node.id}" already exists`)
    }
    await this.context.graph.addNode(node.id, nodeToAttrs(node))
    await this.context.text.index(node.id, nodeToSearchFields(node))
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
    const attrs = await this.context.graph.getNode(id)
    return attrs ? attrsToNode(id, attrs) : undefined
  }

  async updateNode(id: string, updates: Partial<Node>): Promise<void> {
    if (!(await this.context.graph.hasNode(id))) {
      throw new Error(`Node with id "${id}" not found`)
    }
    const existing = await this.context.graph.getNode(id)
    if (!existing)
      return
    const mergedNode = { ...attrsToNode(id, existing), ...updates } as Node
    await this.context.graph.updateNode(id, nodeToAttrs(mergedNode))
    await this.context.text.index(id, nodeToSearchFields(mergedNode))
  }

  async removeNode(id: string): Promise<void> {
    if (!(await this.context.graph.hasNode(id))) {
      throw new Error(`Node with id "${id}" not found`)
    }
    await this.context.graph.removeNode(id)
    await this.context.text.remove(id)
  }

  async hasNode(id: string): Promise<boolean> {
    return this.context.graph.hasNode(id)
  }

  async getNodes(): Promise<Node[]> {
    const results = await this.context.graph.getNodes()
    return results.map(r => attrsToNode(r.id, r.attrs))
  }

  async getHighLevelNodes(): Promise<HighLevelNode[]> {
    const results = await this.context.graph.getNodes({ type: 'high_level' })
    return results.map(r => attrsToNode(r.id, r.attrs)).filter(isHighLevelNode)
  }

  async getLowLevelNodes(): Promise<LowLevelNode[]> {
    const results = await this.context.graph.getNodes({ type: 'low_level' })
    return results.map(r => attrsToNode(r.id, r.attrs)).filter(isLowLevelNode)
  }

  // ==================== Edge Operations ====================

  async addEdge(edge: Edge): Promise<void> {
    if (!(await this.context.graph.hasNode(edge.source))) {
      throw new Error(`Source node "${edge.source}" not found`)
    }
    if (!(await this.context.graph.hasNode(edge.target))) {
      throw new Error(`Target node "${edge.target}" not found`)
    }
    await this.context.graph.addEdge(edge.source, edge.target, edgeToAttrs(edge))
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
    const results = await this.context.graph.getEdges()
    return results.map(r => attrsToEdge(r.source, r.target, r.attrs))
  }

  async getFunctionalEdges(): Promise<FunctionalEdge[]> {
    const results = await this.context.graph.getEdges({ type: 'functional' })
    return results.map(r => attrsToEdge(r.source, r.target, r.attrs)).filter(isFunctionalEdge)
  }

  async getDependencyEdges(): Promise<DependencyEdge[]> {
    const results = await this.context.graph.getEdges({ type: 'dependency' })
    return results.map(r => attrsToEdge(r.source, r.target, r.attrs)).filter(isDependencyEdge)
  }

  async getOutEdges(nodeId: string, edgeType?: EdgeType): Promise<Edge[]> {
    const results = await this.context.graph.getEdges({ source: nodeId, type: edgeType })
    return results.map(r => attrsToEdge(r.source, r.target, r.attrs))
  }

  async getInEdges(nodeId: string, edgeType?: EdgeType): Promise<Edge[]> {
    const results = await this.context.graph.getEdges({ target: nodeId, type: edgeType })
    return results.map(r => attrsToEdge(r.source, r.target, r.attrs))
  }

  async getChildren(nodeId: string): Promise<Node[]> {
    const edges = await this.context.graph.getEdges({ source: nodeId, type: 'functional' })
    edges.sort(
      (a, b) =>
        ((a.attrs.sibling_order as number) ?? 0) - ((b.attrs.sibling_order as number) ?? 0),
    )
    const children: Node[] = []
    for (const edge of edges) {
      const attrs = await this.context.graph.getNode(edge.target)
      if (attrs)
        children.push(attrsToNode(edge.target, attrs))
    }
    return children
  }

  async getParent(nodeId: string): Promise<Node | undefined> {
    const edges = await this.context.graph.getEdges({ target: nodeId, type: 'functional' })
    const firstEdge = edges[0]
    if (!firstEdge)
      return undefined
    const attrs = await this.context.graph.getNode(firstEdge.source)
    return attrs ? attrsToNode(firstEdge.source, attrs) : undefined
  }

  async getDependencies(nodeId: string): Promise<Node[]> {
    const edges = await this.context.graph.getEdges({ source: nodeId, type: 'dependency' })
    const nodes: Node[] = []
    for (const edge of edges) {
      const attrs = await this.context.graph.getNode(edge.target)
      if (attrs)
        nodes.push(attrsToNode(edge.target, attrs))
    }
    return nodes
  }

  async getDependents(nodeId: string): Promise<Node[]> {
    const edges = await this.context.graph.getEdges({ target: nodeId, type: 'dependency' })
    const nodes: Node[] = []
    for (const edge of edges) {
      const attrs = await this.context.graph.getNode(edge.source)
      if (attrs)
        nodes.push(attrsToNode(edge.source, attrs))
    }
    return nodes
  }

  // ==================== Data Flow Edge Operations ====================

  async addDataFlowEdge(params: {
    from: string
    to: string
    dataId: string
    dataType: string
    transformation?: string
  }): Promise<DataFlowEdge> {
    if (!(await this.hasNode(params.from))) {
      throw new Error(`Source node "${params.from}" not found`)
    }
    if (params.from !== params.to && !(await this.hasNode(params.to))) {
      throw new Error(`Target node "${params.to}" not found`)
    }
    const edge = createDataFlowEdge(params)
    this.dataFlowEdges.push(edge)
    return edge
  }

  async getDataFlowEdges(): Promise<DataFlowEdge[]> {
    return [...this.dataFlowEdges]
  }

  // ==================== Graph Operations ====================

  async getTopologicalOrder(): Promise<Node[]> {
    // Kahn's algorithm at RPG layer
    const allNodes = await this.context.graph.getNodes()
    const depEdges = await this.context.graph.getEdges({ type: 'dependency' })

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

  async searchByFeature(query: string, scopes?: string[]): Promise<Node[]> {
    if (scopes && scopes.length > 0) {
      // Collect subtree IDs via BFS on functional edges
      const subtreeIds = new Set<string>()
      const bfsQueue = [...scopes]
      while (bfsQueue.length > 0) {
        const current = bfsQueue.shift()!
        if (subtreeIds.has(current))
          continue
        subtreeIds.add(current)
        const childEdges = await this.context.graph.getEdges({
          source: current,
          type: 'functional',
        })
        for (const e of childEdges) {
          if (!subtreeIds.has(e.target))
            bfsQueue.push(e.target)
        }
      }

      // Text search then filter by subtree
      const hits = await this.context.text.search(query, {
        fields: ['feature_desc', 'feature_keywords'],
      })
      const filteredHits = hits.filter(h => subtreeIds.has(h.id))
      const nodes: Node[] = []
      for (const hit of filteredHits) {
        const attrs = await this.context.graph.getNode(hit.id)
        if (attrs)
          nodes.push(attrsToNode(hit.id, attrs))
      }
      return nodes
    }

    const hits = await this.context.text.search(query, {
      fields: ['feature_desc', 'feature_keywords'],
    })
    const nodes: Node[] = []
    for (const hit of hits) {
      const attrs = await this.context.graph.getNode(hit.id)
      if (attrs)
        nodes.push(attrsToNode(hit.id, attrs))
    }
    return nodes
  }

  async searchByPath(pattern: string): Promise<Node[]> {
    // Path search uses glob/regex matching, not FTS
    const allNodes = await this.context.graph.getNodes()
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
        if (path && regex.test(path))
          return true
        const extraPathsRaw = (r.attrs.extra as Record<string, unknown> | undefined)?.paths
        if (!Array.isArray(extraPathsRaw))
          return false
        return extraPathsRaw.some(p => typeof p === 'string' && regex.test(p))
      })
      .map(r => attrsToNode(r.id, r.attrs))
  }

  // ==================== Serialization ====================

  async serialize(): Promise<SerializedRPG> {
    const nodes = await this.getNodes()
    const edges = await this.getEdges()
    const result: SerializedRPG = {
      version: '1.0.0',
      config: this.config,
      nodes,
      edges,
    }
    if (this.dataFlowEdges.length > 0) {
      result.dataFlowEdges = [...this.dataFlowEdges]
    }
    return result
  }

  async toJSON(): Promise<string> {
    const data = await this.serialize()
    return JSON.stringify(data, null, 2)
  }

  static async deserialize(
    data: SerializedRPG,
    context?: ContextStore,
  ): Promise<RepositoryPlanningGraph> {
    const parsed = SerializedRPGSchema.parse(data)
    const rpg = await RepositoryPlanningGraph.create(parsed.config, context)

    // Import nodes and edges
    for (const nodeData of parsed.nodes) {
      const node = nodeData as Node
      await rpg.addNode(node)
    }
    for (const edgeData of parsed.edges) {
      const edge = edgeData as Edge
      await rpg.addEdge(edge)
    }

    // Import data flow edges with individual validation
    if (parsed.dataFlowEdges) {
      for (const dfEdge of parsed.dataFlowEdges) {
        const result = DataFlowEdgeSchema.safeParse(dfEdge)
        if (result.success) {
          rpg.dataFlowEdges.push(result.data)
        }
        else {
          log.warn(`Skipping invalid dataFlowEdge during deserialization: ${result.error.message}`)
        }
      }
    }

    return rpg
  }

  static async fromJSON(
    json: string,
    context?: ContextStore,
  ): Promise<RepositoryPlanningGraph> {
    return RepositoryPlanningGraph.deserialize(JSON.parse(json), context)
  }

  // ==================== Statistics ====================

  async getStats(): Promise<GraphStats> {
    const allNodes = await this.context.graph.getNodes()
    const allEdges = await this.context.graph.getEdges()

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
      ...(this.dataFlowEdges.length > 0 && { dataFlowEdgeCount: this.dataFlowEdges.length }),
    }
  }

  getConfig(): RPGConfig {
    return { ...this.config }
  }

  /**
   * Update mutable config fields (e.g., github.commit after encode/evolve).
   * The config reference is readonly but internal fields are mutable.
   */
  updateConfig(updates: Partial<RPGConfig>): void {
    if (updates.name !== undefined) {
      ;(this.config as RPGConfig).name = updates.name
    }
    if (updates.rootPath !== undefined) {
      ;(this.config as RPGConfig).rootPath = updates.rootPath
    }
    if (updates.description !== undefined) {
      ;(this.config as RPGConfig).description = updates.description
    }
    if (updates.github !== undefined) {
      ;(this.config as RPGConfig).github = updates.github
    }
  }

  async close(): Promise<void> {
    await this.context.close()
  }
}
