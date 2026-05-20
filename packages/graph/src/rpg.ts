import type { ContextStore } from '@pleaseai/soop-store/context-store'
import type { DataFlowEdge, DependencyEdge, Edge, EdgeType, FunctionalEdge } from './edge'
import type { RPGMeta } from './meta'
import type { HighLevelNode, LowLevelNode, Node, SemanticFeature, StructuralMetadata } from './node'
import type { PythonRPG } from './python-format'
import { DefaultContextStore } from '@pleaseai/soop-store/default-context-store'
import { createLogger } from '@pleaseai/soop-utils/logger'
import { attrsToEdge, attrsToNode, edgeToAttrs, nodeToAttrs, nodeToSearchFields } from './adapters'
import {
  createDataFlowEdge,
  createDependencyEdge,
  createFunctionalEdge,
  DataFlowEdgeSchema,
  isDataFlowEdge,
  isDependencyEdge,
  isFunctionalEdge,
  LegacyDataFlowEdgeSchema,
} from './edge'
import { absorbLegacyGithubCommit, type GitMeta, serializeMeta } from './meta'
import {
  createHighLevelNode,
  createLowLevelNode,
  isHighLevelNode,
  isLowLevelNode,
} from './node'
import {
  computeNodeLevels,
  fromPythonDataFlow,
  fromPythonEdge,
  fromPythonNode,
  PythonRPGSchema,
  toPythonDataFlow,
  toPythonEdge,
  toPythonNode,
} from './python-format'

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
 * Serialized RPG format — Python-compatible rpg_encoder.json format.
 * Re-exported from python-format.ts for convenience.
 */
export { PythonRPGSchema as SerializedRPGSchema } from './python-format'
export type { PythonRPG as SerializedRPG } from './python-format'

/**
 * Repository Planning Graph
 *
 * A hierarchical, dual-view graph G = (V, E) that combines:
 * - Nodes: High-level (architectural) and Low-level (implementation)
 * - Edges: Functional (hierarchy), Dependency (imports/calls), and DataFlow (inter-module communication)
 *
 * Delegates storage to a ContextStore (graph + text + vector).
 */
export class RepositoryPlanningGraph {
  private readonly context: ContextStore
  private readonly config: RPGConfig
  private depGraphFile: string | null = null

  constructor(config: RPGConfig, context: ContextStore) {
    this.config = config
    this.context = context
  }

  /**
   * Record the (relative) path of a sidecar dep_graph.json so that the
   * next serialize() / save() embeds a `dep_graph_file` reference.
   * Mirrors RPG-Kit `run_encode.py` lines 119-130.
   */
  setDepGraphFile(relativePath: string | null): void {
    this.depGraphFile = relativePath
  }

  getDepGraphFile(): string | null {
    return this.depGraphFile
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
    symbol?: string
    targetSymbol?: string
  }): Promise<DependencyEdge> {
    const edge = createDependencyEdge(params)
    await this.addEdge(edge)
    return edge
  }

  /** Remove an edge. No-op if the edge does not exist. */
  async removeEdge(source: string, target: string, type: string): Promise<void> {
    await this.context.graph.removeEdge(source, target, type)
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
    source: string
    target: string
    dataId: string
    dataType: string
    transformation?: string
  }): Promise<DataFlowEdge> {
    if (!(await this.hasNode(params.source))) {
      throw new Error(`Source node "${params.source}" not found`)
    }
    if (params.source !== params.target && !(await this.hasNode(params.target))) {
      throw new Error(`Target node "${params.target}" not found`)
    }
    const edge = createDataFlowEdge(params)
    await this.addEdge(edge)
    return edge
  }

  async getDataFlowEdges(): Promise<DataFlowEdge[]> {
    const results = await this.context.graph.getEdges({ type: 'data_flow' })
    return results.map(r => attrsToEdge(r.source, r.target, r.attrs)).filter(isDataFlowEdge)
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

  async serialize(): Promise<PythonRPG> {
    const nodes = await this.getNodes()
    const allEdges = await this.getEdges()

    const functionalEdges = allEdges.filter(isFunctionalEdge)
    const levels = computeNodeLevels(
      nodes.map(n => n.id),
      functionalEdges,
    )

    // Find root node: prefer high-level nodes at level 0 to avoid
    // promoting arbitrary file nodes to repo root in rootless graphs
    let repoNodeId: string | null = null
    for (const [id, level] of levels) {
      if (level === 0) {
        const node = nodes.find(n => n.id === id)
        if (node && isHighLevelNode(node)) {
          repoNodeId = id
          break
        }
        // Remember first level-0 as fallback
        if (!repoNodeId)
          repoNodeId = id
      }
    }
    if (!repoNodeId) {
      repoNodeId = `${this.config.name}_L0`
    }

    // Convert nodes to Python format
    const pythonNodes = nodes
      .map(n => toPythonNode(n, levels.get(n.id) ?? 5))
      .sort((a, b) => a.id.localeCompare(b.id))

    // Convert edges (excluding data_flow)
    const regularEdges = allEdges.filter(e => e.type !== 'data_flow')
    const pythonEdges = regularEdges
      .map(e => toPythonEdge(e))
      .sort((a, b) => a.src.localeCompare(b.src) || a.dst.localeCompare(b.dst))

    // Data flow edges
    const dataFlowEdges = allEdges.filter(isDataFlowEdge)
    const dataFlow = dataFlowEdges
      .map(e => toPythonDataFlow(e))
      .filter(Boolean)
      .sort((a: any, b: any) =>
        String(a?.source ?? '').localeCompare(String(b?.source ?? ''))
        || String(a?.target ?? '').localeCompare(String(b?.target ?? '')))

    return {
      repo_name: this.config.name,
      repo_info: this.config.description ?? '',
      data_flow: dataFlow,
      excluded_files: [],
      repo_node_id: repoNodeId,
      nodes: pythonNodes,
      edges: pythonEdges,
      _dep_to_rpg_map: {},
      dep_graph: null,
      ...(this.depGraphFile ? { dep_graph_file: this.depGraphFile } : {}),
    }
  }

  serializeMeta(graphPath?: string): RPGMeta {
    return serializeMeta(this.config, graphPath, this.gitMeta ?? undefined)
  }

  // ==================== Git Meta ====================

  private gitMeta: GitMeta | null = null

  /**
   * Record the git baseline (commit / branch / timestamp) the graph was
   * last synced against. Emitted as `meta.git` on the next save.
   */
  setGitMeta(meta: GitMeta | null): void {
    this.gitMeta = meta
  }

  /** Clear the git baseline. Equivalent to `setGitMeta(null)`. */
  clearGitMeta(): void {
    this.gitMeta = null
  }

  /** Read the current git baseline, or `null` when none is set. */
  getGitMeta(): GitMeta | null {
    return this.gitMeta
  }

  async toJSON(): Promise<string> {
    const data = await this.serialize()
    return JSON.stringify(data, null, 2)
  }

  async toJSONWithMeta(graphPath?: string): Promise<{ graphJson: string, metaJson: string }> {
    const data = await this.serialize()
    return {
      graphJson: JSON.stringify(data, null, 2),
      metaJson: JSON.stringify(this.serializeMeta(graphPath), null, 2),
    }
  }

  async toJSONL(): Promise<string> {
    const { serializeGraphJsonl } = await import('./jsonl')
    const data = await this.serialize()
    return serializeGraphJsonl(data)
  }

  async toJSONLWithMeta(graphPath?: string): Promise<{ graphJsonl: string, metaJson: string }> {
    const { serializeGraphJsonl } = await import('./jsonl')
    const data = await this.serialize()
    return {
      graphJsonl: serializeGraphJsonl(data),
      metaJson: JSON.stringify(this.serializeMeta(graphPath), null, 2),
    }
  }

  static async deserialize(
    data: PythonRPG | Record<string, unknown>,
    context?: ContextStore,
  ): Promise<RepositoryPlanningGraph> {
    // Detect legacy v1.0.0 format: has `version` and `config` fields instead of `repo_name`
    if (
      typeof data === 'object'
      && data !== null
      && 'version' in data
      && 'config' in data
      && !('repo_name' in data)
    ) {
      return RepositoryPlanningGraph._deserializeLegacy(data as Record<string, unknown>, context)
    }

    const parsed = PythonRPGSchema.parse(data)
    const config: RPGConfig = {
      name: parsed.repo_name,
      description: parsed.repo_info || undefined,
    }
    const rpg = await RepositoryPlanningGraph.create(config, context)

    // Import nodes
    for (const nodeData of parsed.nodes) {
      try {
        const node = fromPythonNode(nodeData as any)
        await rpg.addNode(node)
      }
      catch (error) {
        const id = (nodeData as any)?.id ?? 'unknown'
        log.warn(`Skipping invalid node "${id}" during deserialization: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Import edges
    for (const edgeData of parsed.edges) {
      try {
        const edge = fromPythonEdge(edgeData as any)
        await rpg.addEdge(edge)
      }
      catch (error) {
        const src = (edgeData as any)?.src ?? 'unknown'
        const dst = (edgeData as any)?.dst ?? 'unknown'
        log.warn(`Skipping invalid edge "${src}→${dst}" during deserialization: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Import data flow
    for (const dfData of parsed.data_flow) {
      try {
        const edge = fromPythonDataFlow(dfData)
        if (edge)
          await rpg.addEdge(edge)
      }
      catch (error) {
        log.warn(`Skipping invalid data_flow during deserialization: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (parsed.dep_graph_file) {
      rpg.setDepGraphFile(parsed.dep_graph_file)
    }

    return rpg
  }

  /**
   * Deserialize legacy v1.0.0 format: { version, config, nodes, edges, dataFlowEdges? }
   */
  private static async _deserializeLegacy(
    data: Record<string, unknown>,
    context?: ContextStore,
  ): Promise<RepositoryPlanningGraph> {
    const legacyConfig = data.config as RPGConfig
    const config: RPGConfig = {
      name: legacyConfig?.name ?? 'unknown',
      rootPath: legacyConfig?.rootPath,
      description: legacyConfig?.description,
      github: legacyConfig?.github,
    }
    const rpg = await RepositoryPlanningGraph.create(config, context)
    const nodes = Array.isArray(data.nodes) ? data.nodes : []
    const edges = Array.isArray(data.edges) ? data.edges : []
    const dataFlowEdges = Array.isArray(data.dataFlowEdges) ? data.dataFlowEdges : []

    for (const nodeData of nodes) {
      try {
        await rpg.addNode(nodeData as Node)
      }
      catch (error) {
        const id = (nodeData as any)?.id ?? 'unknown'
        log.warn(`Skipping invalid legacy node "${id}" during deserialization: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    for (const edgeData of edges) {
      try {
        await rpg.addEdge(edgeData as Edge)
      }
      catch (error) {
        const src = (edgeData as any)?.source ?? 'unknown'
        const dst = (edgeData as any)?.target ?? 'unknown'
        log.warn(`Skipping invalid legacy edge "${src}→${dst}" during deserialization: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    for (const dfEdge of dataFlowEdges) {
      const newResult = DataFlowEdgeSchema.safeParse(dfEdge)
      if (newResult.success) {
        try {
          await rpg.addEdge(newResult.data)
        }
        catch (error) {
          log.warn(`Skipping invalid legacy data_flow during deserialization: ${error instanceof Error ? error.message : String(error)}`)
        }
        continue
      }
      const legacyResult = LegacyDataFlowEdgeSchema.safeParse(dfEdge)
      if (legacyResult.success) {
        try {
          const legacy = legacyResult.data
          const edge = createDataFlowEdge({
            source: legacy.from,
            target: legacy.to,
            dataId: legacy.dataId,
            dataType: legacy.dataType,
            transformation: legacy.transformation,
          })
          await rpg.addEdge(edge)
        }
        catch (error) {
          log.warn(`Skipping invalid legacy data_flow during deserialization: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      else {
        log.warn(`Skipping invalid legacy dataFlowEdge during deserialization`)
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

  static async fromJSONWithMeta(
    graphJson: string,
    metaJson?: string,
    context?: ContextStore,
    graphPath?: string,
  ): Promise<RepositoryPlanningGraph> {
    const rpg = await RepositoryPlanningGraph.fromJSON(graphJson, context)
    if (metaJson) {
      const { deserializeMeta } = await import('./meta')
      const rawMeta = deserializeMeta(JSON.parse(metaJson), graphPath)
      // Absorb legacy github.commit → git.headCommit when no git block exists
      const meta = absorbLegacyGithubCommit(rawMeta)
      rpg.updateConfig({
        rootPath: meta.rootPath,
        github: meta.github,
      })
      if (meta.git)
        rpg.setGitMeta(meta.git)
    }
    return rpg
  }

  static async fromJSONL(
    jsonl: string,
    context?: ContextStore,
  ): Promise<RepositoryPlanningGraph> {
    const { parseGraphJsonl } = await import('./jsonl')
    return RepositoryPlanningGraph.deserialize(parseGraphJsonl(jsonl), context)
  }

  static async fromJSONLWithMeta(
    graphJsonl: string,
    metaJson?: string,
    context?: ContextStore,
    graphPath?: string,
  ): Promise<RepositoryPlanningGraph> {
    const rpg = await RepositoryPlanningGraph.fromJSONL(graphJsonl, context)
    if (metaJson) {
      const { deserializeMeta } = await import('./meta')
      const rawMeta = deserializeMeta(JSON.parse(metaJson), graphPath)
      // Absorb legacy github.commit → git.headCommit when no git block exists
      const meta = absorbLegacyGithubCommit(rawMeta)
      rpg.updateConfig({
        rootPath: meta.rootPath,
        github: meta.github,
      })
      if (meta.git)
        rpg.setGitMeta(meta.git)
    }
    return rpg
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
    let dataFlowCount = 0
    for (const { attrs } of allEdges) {
      if (attrs.type === 'functional')
        functionalCount++
      else if (attrs.type === 'dependency')
        dependencyCount++
      else if (attrs.type === 'data_flow')
        dataFlowCount++
    }

    return {
      nodeCount: allNodes.length,
      edgeCount: allEdges.length,
      highLevelNodeCount: highLevelCount,
      lowLevelNodeCount: lowLevelCount,
      functionalEdgeCount: functionalCount,
      dependencyEdgeCount: dependencyCount,
      ...(dataFlowCount > 0 && { dataFlowEdgeCount: dataFlowCount }),
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
      this.config.name = updates.name
    }
    if (updates.rootPath !== undefined) {
      this.config.rootPath = updates.rootPath
    }
    if (updates.description !== undefined) {
      this.config.description = updates.description
    }
    if (updates.github !== undefined) {
      this.config.github = updates.github
    }
  }

  async close(): Promise<void> {
    await this.context.close()
  }
}
