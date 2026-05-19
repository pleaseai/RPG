import type { DependencyEdge, Edge, Node, RepositoryPlanningGraph } from '@pleaseai/soop-graph'
import { EdgeType, isDependencyEdge } from '@pleaseai/soop-graph'
import { suggestNodes } from '@pleaseai/soop-graph/fuzzy'

/**
 * Edge type for exploration
 */
export type ExploreEdgeType = 'containment' | 'dependency' | 'data_flow' | 'all'

/**
 * Default maximum edges returned before truncation kicks in.
 * Mirrors Python `_MAX_EXPLORE_EDGES`.
 */
export const DEFAULT_MAX_EXPLORE_EDGES = 20

/**
 * Options for ExploreRPG
 */
export interface ExploreOptions {
  /** Starting node ID */
  startNode: string
  /** Type of edges to traverse */
  edgeType: ExploreEdgeType
  /** Maximum depth to explore */
  maxDepth?: number
  /** Direction: downstream (out-edges), upstream (in-edges), or both */
  direction?: 'downstream' | 'upstream' | 'both'
  /** Filter dependency edges by their dependency type */
  dependencyType?: 'import' | 'call' | 'inherit' | 'implement' | 'use'
  /** Maximum edges to collect before truncating (default: 20) */
  maxEdges?: number
}

/**
 * Explore result
 */
export interface ExploreResult {
  /** Nodes discovered */
  nodes: Node[]
  /** Edges traversed */
  edges: Array<{ source: string, target: string, type: string }>
  /** Depth reached */
  maxDepthReached: number
  /** Requested startNode that could not be found */
  notFound?: string
  /** Suggested similar node IDs when startNode was not found */
  suggestions?: string[]
  /** Set to true when edge collection was capped by maxEdges (default 20) */
  truncated?: boolean
}

/**
 * Internal state for exploration
 */
interface ExploreState {
  visited: Set<string>
  nodes: Node[]
  edges: Array<{ source: string, target: string, type: string }>
  maxDepthReached: number
  maxEdges: number
  truncated: boolean
}

/**
 * ExploreRPG - Cross-view traversal
 *
 * Navigate along containment (hierarchy) and dependency (import/call) edges
 * to discover related modules and interactions.
 */
export class ExploreRPG {
  private readonly rpg: RepositoryPlanningGraph

  constructor(rpg: RepositoryPlanningGraph) {
    this.rpg = rpg
  }

  /**
   * Traverse the graph from a starting node
   */
  async traverse(options: ExploreOptions): Promise<ExploreResult> {
    const {
      startNode,
      edgeType,
      maxDepth = 3,
      direction = 'downstream',
      dependencyType,
      maxEdges = DEFAULT_MAX_EXPLORE_EDGES,
    } = options

    const exists = await this.rpg.hasNode(startNode)
    if (!exists) {
      const suggestions = await suggestNodes(this.rpg, startNode, { limit: 5 })
      const result: ExploreResult = {
        nodes: [],
        edges: [],
        maxDepthReached: 0,
        notFound: startNode,
      }
      if (suggestions.length > 0) {
        result.suggestions = suggestions
      }
      return result
    }

    const state: ExploreState = {
      visited: new Set<string>(),
      nodes: [],
      edges: [],
      maxDepthReached: 0,
      maxEdges,
      truncated: false,
    }

    const edgeTypes = this.resolveEdgeTypes(edgeType)
    await this.exploreNode(startNode, 0, maxDepth, direction, edgeTypes, state, dependencyType)

    const result: ExploreResult = {
      nodes: state.nodes,
      edges: state.edges,
      maxDepthReached: state.maxDepthReached,
    }
    if (state.truncated) {
      result.truncated = true
    }
    return result
  }

  /**
   * Resolve edge type option to EdgeType array
   */
  private resolveEdgeTypes(edgeType: ExploreEdgeType): EdgeType[] {
    switch (edgeType) {
      case 'all':
        return [EdgeType.Functional, EdgeType.Dependency, EdgeType.DataFlow]
      case 'containment':
        return [EdgeType.Functional]
      case 'dependency':
        return [EdgeType.Dependency]
      case 'data_flow':
        return [EdgeType.DataFlow]
    }
  }

  /**
   * Recursively explore a node and its connected edges
   */
  private async exploreNode(
    nodeId: string,
    depth: number,
    maxDepth: number,
    direction: 'downstream' | 'upstream' | 'both',
    edgeTypes: EdgeType[],
    state: ExploreState,
    dependencyType?: string,
  ): Promise<void> {
    if (depth > maxDepth || state.visited.has(nodeId)) {
      return
    }
    state.visited.add(nodeId)

    const node = await this.rpg.getNode(nodeId)
    if (!node) {
      return
    }

    state.nodes.push(node)
    state.maxDepthReached = Math.max(state.maxDepthReached, depth)

    for (const et of edgeTypes) {
      await this.processEdges(nodeId, depth, maxDepth, direction, et, state, dependencyType)
    }
  }

  /**
   * Process edges for a node in given direction
   */
  private async processEdges(
    nodeId: string,
    depth: number,
    maxDepth: number,
    direction: 'downstream' | 'upstream' | 'both',
    edgeType: EdgeType,
    state: ExploreState,
    dependencyType?: string,
  ): Promise<void> {
    if (direction === 'downstream' || direction === 'both') {
      await this.processOutEdges(nodeId, depth, maxDepth, direction, edgeType, state, dependencyType)
    }

    if (direction === 'upstream' || direction === 'both') {
      await this.processInEdges(nodeId, depth, maxDepth, direction, edgeType, state, dependencyType)
    }
  }

  /**
   * Check if an edge passes the dependency type filter
   */
  private matchesDependencyType(edge: Edge, dependencyType?: string): boolean {
    if (!dependencyType)
      return true
    if (!isDependencyEdge(edge))
      return true
    return (edge as DependencyEdge).dependencyType === dependencyType
  }

  /**
   * Process outgoing edges
   */
  private async processOutEdges(
    nodeId: string,
    depth: number,
    maxDepth: number,
    direction: 'downstream' | 'upstream' | 'both',
    edgeType: EdgeType,
    state: ExploreState,
    dependencyType?: string,
  ): Promise<void> {
    const edgeTypes = [edgeType]
    for (const edge of await this.rpg.getOutEdges(nodeId, edgeType)) {
      if (!this.matchesDependencyType(edge, dependencyType))
        continue
      if (!this.addEdge(edge, state))
        return
      await this.exploreNode(edge.target, depth + 1, maxDepth, direction, edgeTypes, state, dependencyType)
    }
  }

  /**
   * Process incoming edges
   */
  private async processInEdges(
    nodeId: string,
    depth: number,
    maxDepth: number,
    direction: 'downstream' | 'upstream' | 'both',
    edgeType: EdgeType,
    state: ExploreState,
    dependencyType?: string,
  ): Promise<void> {
    const edgeTypes = [edgeType]
    for (const edge of await this.rpg.getInEdges(nodeId, edgeType)) {
      if (!this.matchesDependencyType(edge, dependencyType))
        continue
      if (!this.addEdge(edge, state))
        return
      await this.exploreNode(edge.source, depth + 1, maxDepth, direction, edgeTypes, state, dependencyType)
    }
  }

  /**
   * Add an edge to the state, respecting the maxEdges cap.
   * Returns true if the edge was added, false when the cap is reached
   * so callers can stop further traversal.
   */
  private addEdge(edge: Edge, state: ExploreState): boolean {
    if (state.edges.length >= state.maxEdges) {
      state.truncated = true
      return false
    }
    state.edges.push({
      source: edge.source,
      target: edge.target,
      type: edge.type,
    })
    return true
  }
}
