import type { EntityType, Node, RepositoryPlanningGraph } from '@pleaseai/soop-graph'
import path from 'node:path'
import { EdgeType, isHighLevelNode } from '@pleaseai/soop-graph'
import { suggestNodes } from '@pleaseai/soop-graph/fuzzy'

/**
 * Default max depth for tree listing
 */
const DEFAULT_MAX_DEPTH = 2

/**
 * Synthetic root id used when the graph has multiple top-level nodes
 */
export const SYNTHETIC_ROOT_ID = '__root__'

/**
 * Options for RPGTree.list
 */
export interface TreeOptions {
  /** Start node ID (default: synthetic root containing all top-level nodes) */
  rootId?: string
  /** Maximum tree depth to expand (default: 2) */
  maxDepth?: number
}

/**
 * Tree node entry
 */
export interface TreeNode {
  /** Node identifier */
  id: string
  /** Display name derived from metadata, directoryPath, or feature description */
  name: string
  /** Node type */
  type: 'high_level' | 'low_level'
  /** Code entity type for low-level nodes (file, class, function, ...) */
  entityType?: EntityType
  /** Source path for low-level nodes */
  path?: string
  /** Expanded children (present when within maxDepth) */
  children?: TreeNode[]
  /** Number of un-expanded children (present when truncated by depth) */
  childrenCount?: number
}

/**
 * Result of a tree query
 */
export interface TreeResult {
  /** Tree rooted at the requested (or synthetic) root */
  root: TreeNode | null
  /** Total nodes in the entire graph */
  totalNodes: number
  /** Total nodes in the returned subtree (only when rootId was specified) */
  subtreeNodes?: number
  /** Requested rootId that could not be found */
  notFound?: string
  /** Suggested similar node IDs when rootId was not found */
  suggestions?: string[]
}

/**
 * RPGTree — feature hierarchy browser
 *
 * Mirrors the Python `GraphQueryEngine.list_tree` shape, returning a nested
 * `{id, name, type, path, children?}` structure with `childrenCount` when
 * traversal is truncated by maxDepth. Designed as the first call for agents
 * orienting themselves in an unfamiliar codebase.
 */
export class RPGTree {
  private readonly rpg: RepositoryPlanningGraph

  constructor(rpg: RepositoryPlanningGraph) {
    this.rpg = rpg
  }

  /**
   * List the feature tree starting at rootId (or all top-level nodes).
   */
  async list(options: TreeOptions = {}): Promise<TreeResult> {
    const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
    const allNodes = await this.rpg.getNodes()
    const totalNodes = allNodes.length

    if (options.rootId) {
      return this.listFromRoot(options.rootId, maxDepth, totalNodes)
    }

    return this.listDefaultRoot(maxDepth, totalNodes)
  }

  private async listFromRoot(rootId: string, maxDepth: number, totalNodes: number): Promise<TreeResult> {
    const node = await this.rpg.getNode(rootId)
    if (!node) {
      const suggestions = await this.suggestRoots(rootId)
      return { root: null, notFound: rootId, suggestions, totalNodes }
    }

    const counter = { n: 0 }
    const tree = await this.buildTree(node, 0, maxDepth, counter)
    return { root: tree, totalNodes, subtreeNodes: counter.n }
  }

  private async listDefaultRoot(maxDepth: number, totalNodes: number): Promise<TreeResult> {
    const topLevel = await this.findTopLevelNodes()

    if (topLevel.length === 1) {
      const counter = { n: 0 }
      const tree = await this.buildTree(topLevel[0]!, 0, maxDepth, counter)
      return { root: tree, totalNodes }
    }

    // Synthetic root wrapping multiple top-level nodes
    const counter = { n: 0 }
    const children: TreeNode[] = []
    for (const node of topLevel) {
      children.push(await this.buildTree(node, 1, maxDepth, counter))
    }
    const syntheticRoot: TreeNode = {
      id: SYNTHETIC_ROOT_ID,
      name: this.rpg.getConfig().name || 'Repository',
      type: 'high_level',
      children: children.length > 0 ? children : undefined,
    }
    return { root: syntheticRoot, totalNodes }
  }

  private async buildTree(
    node: Node,
    depth: number,
    maxDepth: number,
    counter: { n: number },
  ): Promise<TreeNode> {
    counter.n += 1
    const entry: TreeNode = {
      id: node.id,
      name: getDisplayName(node),
      type: node.type,
    }
    if (node.metadata?.entityType) {
      entry.entityType = node.metadata.entityType
    }
    if (node.metadata?.path) {
      entry.path = node.metadata.path
    }
    else if (isHighLevelNode(node) && node.directoryPath) {
      entry.path = node.directoryPath
    }

    const children = await this.rpg.getChildren(node.id)
    if (children.length === 0) {
      return entry
    }

    if (depth < maxDepth) {
      const expanded: TreeNode[] = []
      for (const child of children) {
        expanded.push(await this.buildTree(child, depth + 1, maxDepth, counter))
      }
      entry.children = expanded
    }
    else {
      entry.childrenCount = children.length
    }

    return entry
  }

  /**
   * Find nodes that have no incoming functional edge (graph roots).
   */
  private async findTopLevelNodes(): Promise<Node[]> {
    const all = await this.rpg.getNodes()
    const incomingCounts = await Promise.all(
      all.map(async node => (await this.rpg.getInEdges(node.id, EdgeType.Functional)).length),
    )
    return all.filter((_, i) => incomingCounts[i] === 0)
  }

  /**
   * Suggest node IDs similar to the failed root lookup.
   */
  private async suggestRoots(query: string): Promise<string[]> {
    return suggestNodes(this.rpg, query, { limit: 5 })
  }
}

/**
 * Derive a short display name for a node.
 * Preference order: qualifiedName → directoryPath basename → path basename → feature description.
 */
export function getDisplayName(node: Node): string {
  if (node.metadata?.qualifiedName) {
    return node.metadata.qualifiedName
  }
  if (isHighLevelNode(node) && node.directoryPath) {
    return basename(node.directoryPath) || node.directoryPath
  }
  if (node.metadata?.path) {
    return basename(node.metadata.path) || node.metadata.path
  }
  const desc = node.feature.description
  return desc.length > 60 ? `${desc.slice(0, 57)}...` : desc
}

function basename(pathStr: string): string {
  const normalized = pathStr.split(path.sep).join('/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.at(-1) ?? ''
}
