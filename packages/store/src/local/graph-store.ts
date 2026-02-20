import type { GraphStore } from '../graph-store'
import type {
  EdgeAttrs,
  EdgeFilter,
  NodeAttrs,
  NodeFilter,
  SerializedGraph,
  TraverseOpts,
  TraverseResult,
} from '../types'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface StoredEdge {
  source: string
  target: string
  attrs: EdgeAttrs
}

interface PersistedData {
  nodes: Array<{ id: string, attrs: NodeAttrs }>
  edges: StoredEdge[]
}

/**
 * LocalGraphStore — Zero-dependency, JSON file-based GraphStore.
 *
 * Uses in-memory Maps for nodes and an array for edges, with JSON file
 * persistence (same pattern as LocalVectorStore). Suitable as a
 * better-sqlite3 fallback when native binaries are unavailable.
 *
 * Storage: single JSON file at `{path}/graph.json`.
 * Memory mode: pass path `'memory'` to use a temp directory.
 */
export class LocalGraphStore implements GraphStore {
  private nodes: Map<string, NodeAttrs> = new Map()
  private edges: StoredEdge[] = []
  private filePath: string | null = null
  private _tempDir: string | undefined = undefined

  async open(config: unknown): Promise<void> {
    if (
      typeof config !== 'object'
      || config === null
      || typeof (config as Record<string, unknown>).path !== 'string'
    ) {
      throw new TypeError(
        `LocalGraphStore.open() requires config.path: string, got: ${JSON.stringify(config)}`,
      )
    }
    const cfg = config as { path: string }
    let dir = cfg.path

    if (dir === 'memory') {
      dir = mkdtempSync(join(tmpdir(), 'rpg-local-graph-'))
      this._tempDir = dir
    }
    else {
      mkdirSync(dir, { recursive: true })
    }

    this.filePath = join(dir, 'graph.json')

    try {
      const raw = readFileSync(this.filePath, 'utf8')
      const stored = JSON.parse(raw) as PersistedData
      this.nodes = new Map(stored.nodes.map(n => [n.id, n.attrs]))
      this.edges = stored.edges
    }
    catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.nodes = new Map()
        this.edges = []
      }
      else {
        throw new Error(
          `Failed to load graph from ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  async close(): Promise<void> {
    try {
      this.flush()
    }
    finally {
      this.nodes = new Map()
      this.edges = []
      this.filePath = null
      if (this._tempDir) {
        rmSync(this._tempDir, { recursive: true, force: true })
        this._tempDir = undefined
      }
    }
  }

  // ==================== Node CRUD ====================

  async addNode(id: string, attrs: NodeAttrs): Promise<void> {
    this.nodes.set(id, attrs)
    this.flush()
  }

  async getNode(id: string): Promise<NodeAttrs | null> {
    return this.nodes.get(id) ?? null
  }

  async hasNode(id: string): Promise<boolean> {
    return this.nodes.has(id)
  }

  async updateNode(id: string, patch: Partial<NodeAttrs>): Promise<void> {
    const existing = this.nodes.get(id)
    if (!existing)
      return
    this.nodes.set(id, { ...existing, ...patch })
    this.flush()
  }

  async removeNode(id: string): Promise<void> {
    this.nodes.delete(id)
    // Cascade-delete edges referencing this node
    this.edges = this.edges.filter(e => e.source !== id && e.target !== id)
    this.flush()
  }

  async getNodes(filter?: NodeFilter): Promise<Array<{ id: string, attrs: NodeAttrs }>> {
    const results: Array<{ id: string, attrs: NodeAttrs }> = []
    for (const [id, attrs] of this.nodes) {
      if (filter) {
        let match = true
        for (const [key, value] of Object.entries(filter)) {
          if (value !== undefined && attrs[key] !== value) {
            match = false
            break
          }
        }
        if (!match)
          continue
      }
      results.push({ id, attrs })
    }
    return results
  }

  // ==================== Edge CRUD ====================

  async addEdge(source: string, target: string, attrs: EdgeAttrs): Promise<void> {
    // Replace existing edge with same identity (source, target, type)
    const idx = this.edges.findIndex(
      e => e.source === source && e.target === target && e.attrs.type === attrs.type,
    )
    if (idx >= 0) {
      this.edges[idx] = { source, target, attrs }
    }
    else {
      this.edges.push({ source, target, attrs })
    }
    this.flush()
  }

  async removeEdge(source: string, target: string, type: string): Promise<void> {
    this.edges = this.edges.filter(
      e => !(e.source === source && e.target === target && e.attrs.type === type),
    )
    this.flush()
  }

  async getEdges(
    filter?: EdgeFilter,
  ): Promise<Array<{ source: string, target: string, attrs: EdgeAttrs }>> {
    let results = this.edges
    if (filter) {
      results = results.filter((e) => {
        if (filter.source !== undefined && e.source !== filter.source)
          return false
        if (filter.target !== undefined && e.target !== filter.target)
          return false
        if (filter.type !== undefined && e.attrs.type !== filter.type)
          return false
        return true
      })
    }
    return results.map(e => ({ source: e.source, target: e.target, attrs: e.attrs }))
  }

  // ==================== Neighbor Queries ====================

  async getNeighbors(
    id: string,
    direction: 'in' | 'out' | 'both',
    edgeType?: string,
  ): Promise<string[]> {
    const results = new Set<string>()
    for (const e of this.edges) {
      if (edgeType !== undefined && e.attrs.type !== edgeType)
        continue
      if ((direction === 'out' || direction === 'both') && e.source === id) {
        results.add(e.target)
      }
      if ((direction === 'in' || direction === 'both') && e.target === id) {
        results.add(e.source)
      }
    }
    return [...results]
  }

  // ==================== Graph Traversal ====================

  async traverse(startId: string, opts: TraverseOpts): Promise<TraverseResult> {
    const { direction, maxDepth, edgeType, filter } = opts

    // BFS
    const visited = new Map<string, number>() // id → depth
    const queue: Array<{ id: string, depth: number }> = [{ id: startId, depth: 0 }]
    visited.set(startId, 0)

    while (queue.length > 0) {
      const current = queue.shift()!
      if (current.depth >= maxDepth)
        continue

      const neighbors = await this.getNeighbors(current.id, direction, edgeType)
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.set(neighbor, current.depth + 1)
          queue.push({ id: neighbor, depth: current.depth + 1 })
        }
      }
    }

    // Collect nodes (exclude start node, apply filter)
    const nodes: Array<{ id: string, attrs: NodeAttrs }> = []
    let maxDepthReached = 0

    for (const [id, depth] of visited) {
      if (id === startId)
        continue
      const attrs = this.nodes.get(id)
      if (!attrs)
        continue

      if (filter) {
        let match = true
        for (const [key, value] of Object.entries(filter)) {
          if (value !== undefined && attrs[key] !== value) {
            match = false
            break
          }
        }
        if (!match)
          continue
      }

      nodes.push({ id, attrs })
      if (depth > maxDepthReached)
        maxDepthReached = depth
    }

    // Collect edges between discovered nodes
    const nodeIdSet = new Set(visited.keys())
    const edges = this.edges.filter(
      e => nodeIdSet.has(e.source) && nodeIdSet.has(e.target)
        && (edgeType === undefined || e.attrs.type === edgeType),
    ).map(e => ({ source: e.source, target: e.target, attrs: e.attrs }))

    return { nodes, edges, maxDepthReached }
  }

  // ==================== Subgraph / Serialization ====================

  async subgraph(nodeIds: string[]): Promise<SerializedGraph> {
    const idSet = new Set(nodeIds)
    const nodes: Array<{ id: string, attrs: NodeAttrs }> = []
    for (const id of nodeIds) {
      const attrs = this.nodes.get(id)
      if (attrs)
        nodes.push({ id, attrs })
    }
    const edges = this.edges
      .filter(e => idSet.has(e.source) && idSet.has(e.target))
      .map(e => ({ source: e.source, target: e.target, attrs: e.attrs }))
    return { nodes, edges }
  }

  async export(): Promise<SerializedGraph> {
    const nodes = [...this.nodes.entries()].map(([id, attrs]) => ({ id, attrs }))
    const edges = this.edges.map(e => ({ source: e.source, target: e.target, attrs: e.attrs }))
    return { nodes, edges }
  }

  async import(data: SerializedGraph): Promise<void> {
    for (const node of data.nodes) {
      this.nodes.set(node.id, node.attrs)
    }
    for (const edge of data.edges) {
      const idx = this.edges.findIndex(
        e => e.source === edge.source && e.target === edge.target && e.attrs.type === edge.attrs.type,
      )
      if (idx >= 0) {
        this.edges[idx] = edge
      }
      else {
        this.edges.push(edge)
      }
    }
    this.flush()
  }

  private flush(): void {
    if (!this.filePath)
      return
    const data: PersistedData = {
      nodes: [...this.nodes.entries()].map(([id, attrs]) => ({ id, attrs })),
      edges: this.edges,
    }
    writeFileSync(this.filePath, JSON.stringify(data), 'utf8')
  }
}
