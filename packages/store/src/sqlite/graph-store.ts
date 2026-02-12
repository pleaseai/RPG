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
import Database from 'better-sqlite3'

type BindValue = string | number | null | undefined

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nodes (
    id    TEXT PRIMARY KEY,
    attrs TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
    source TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    target TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    type   TEXT NOT NULL,
    attrs  TEXT NOT NULL,
    UNIQUE(source, target, type)
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source, type);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target, type);
`

/**
 * SQLiteGraphStore — GraphStore implementation using better-sqlite3.
 *
 * Stores nodes as (id, JSON attrs) and edges as (source, target, type, JSON attrs).
 * Uses recursive CTEs for traversal.
 */
export class SQLiteGraphStore implements GraphStore {
  private db!: InstanceType<typeof Database>

  async open(path: unknown): Promise<void> {
    const p = path as string
    this.db = new Database(p === 'memory' ? ':memory:' : p)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(SCHEMA)
  }

  async close(): Promise<void> {
    this.db.close()
  }

  // ==================== Node CRUD ====================

  async addNode(id: string, attrs: NodeAttrs): Promise<void> {
    this.db.prepare('INSERT INTO nodes (id, attrs) VALUES (?, ?)').run(id, JSON.stringify(attrs))
  }

  async getNode(id: string): Promise<NodeAttrs | null> {
    const row = this.db.prepare('SELECT attrs FROM nodes WHERE id = ?').get(id) as
      | { attrs: string }
      | undefined
    return row ? JSON.parse(row.attrs) : null
  }

  async hasNode(id: string): Promise<boolean> {
    const row = this.db.prepare('SELECT 1 FROM nodes WHERE id = ?').get(id)
    return row !== undefined
  }

  async updateNode(id: string, patch: Partial<NodeAttrs>): Promise<void> {
    const existing = await this.getNode(id)
    if (!existing)
      return
    const merged = { ...existing, ...patch }
    this.db.prepare('UPDATE nodes SET attrs = ? WHERE id = ?').run(JSON.stringify(merged), id)
  }

  async removeNode(id: string): Promise<void> {
    this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id)
  }

  async getNodes(filter?: NodeFilter): Promise<Array<{ id: string, attrs: NodeAttrs }>> {
    const rows = this.db.prepare('SELECT id, attrs FROM nodes').all() as Array<{
      id: string
      attrs: string
    }>

    let results = rows.map(r => ({ id: r.id, attrs: JSON.parse(r.attrs) as NodeAttrs }))

    if (filter) {
      results = results.filter((r) => {
        for (const [key, value] of Object.entries(filter)) {
          if (value !== undefined && r.attrs[key] !== value)
            return false
        }
        return true
      })
    }

    return results
  }

  // ==================== Edge CRUD ====================

  async addEdge(source: string, target: string, attrs: EdgeAttrs): Promise<void> {
    this.db
      .prepare('INSERT INTO edges (source, target, type, attrs) VALUES (?, ?, ?, ?)')
      .run(source, target, attrs.type, JSON.stringify(attrs))
  }

  async removeEdge(source: string, target: string, type: string): Promise<void> {
    this.db
      .prepare('DELETE FROM edges WHERE source = ? AND target = ? AND type = ?')
      .run(source, target, type)
  }

  async getEdges(
    filter?: EdgeFilter,
  ): Promise<Array<{ source: string, target: string, attrs: EdgeAttrs }>> {
    let sql = 'SELECT source, target, attrs FROM edges'
    const conditions: string[] = []
    const values: BindValue[] = []

    if (filter?.type) {
      conditions.push('type = ?')
      values.push(filter.type)
    }
    if (filter?.source) {
      conditions.push('source = ?')
      values.push(filter.source)
    }
    if (filter?.target) {
      conditions.push('target = ?')
      values.push(filter.target)
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`
    }

    const rows = this.db.prepare(sql).all(...values) as Array<{
      source: string
      target: string
      attrs: string
    }>

    return rows.map(r => ({
      source: r.source,
      target: r.target,
      attrs: JSON.parse(r.attrs) as EdgeAttrs,
    }))
  }

  // ==================== Neighbor Queries ====================

  async getNeighbors(
    id: string,
    direction: 'in' | 'out' | 'both',
    edgeType?: string,
  ): Promise<string[]> {
    const results = new Set<string>()
    const typeClause = edgeType ? ' AND type = ?' : ''
    const typeParam = edgeType ? [edgeType] : []

    if (direction === 'out' || direction === 'both') {
      const rows = this.db
        .prepare(`SELECT target FROM edges WHERE source = ?${typeClause}`)
        .all(id, ...typeParam) as Array<{ target: string }>
      for (const r of rows) results.add(r.target)
    }

    if (direction === 'in' || direction === 'both') {
      const rows = this.db
        .prepare(`SELECT source FROM edges WHERE target = ?${typeClause}`)
        .all(id, ...typeParam) as Array<{ source: string }>
      for (const r of rows) results.add(r.source)
    }

    return [...results]
  }

  // ==================== Graph Traversal ====================

  async traverse(startId: string, opts: TraverseOpts): Promise<TraverseResult> {
    const { direction, maxDepth, edgeType } = opts
    const typeClause = edgeType ? `AND e.type = '${edgeType}'` : ''

    let directionClause: string
    let nextNodeExpr: string

    if (direction === 'out') {
      directionClause = 'e.source = t.node_id'
      nextNodeExpr = 'e.target'
    }
    else if (direction === 'in') {
      directionClause = 'e.target = t.node_id'
      nextNodeExpr = 'e.source'
    }
    else {
      directionClause = '(e.source = t.node_id OR e.target = t.node_id)'
      nextNodeExpr = 'CASE WHEN e.source = t.node_id THEN e.target ELSE e.source END'
    }

    const sql = `
      WITH RECURSIVE traversal AS (
        SELECT ? AS node_id, 0 AS depth
        UNION ALL
        SELECT ${nextNodeExpr} AS node_id, t.depth + 1
        FROM edges e
        JOIN traversal t ON ${directionClause}
        WHERE t.depth < ?
          ${typeClause}
      )
      SELECT DISTINCT node_id, depth FROM traversal WHERE depth > 0
    `

    const traversalRows = this.db.prepare(sql).all(startId, maxDepth) as Array<{
      node_id: string
      depth: number
    }>

    const nodes: Array<{ id: string, attrs: NodeAttrs }> = []
    let maxDepthReached = 0

    for (const row of traversalRows) {
      const attrs = await this.getNode(row.node_id)
      if (attrs) {
        // Apply filter
        if (opts.filter) {
          let matches = true
          for (const [key, value] of Object.entries(opts.filter)) {
            if (value !== undefined && attrs[key] !== value) {
              matches = false
              break
            }
          }
          if (!matches)
            continue
        }
        nodes.push({ id: row.node_id, attrs })
      }
      if (row.depth > maxDepthReached)
        maxDepthReached = row.depth
    }

    // Collect edges between discovered nodes
    const nodeIds = new Set([startId, ...traversalRows.map(r => r.node_id)])
    const placeholders = [...nodeIds].map(() => '?').join(',')
    const edgeTypeClause = edgeType ? `AND type = '${edgeType}'` : ''
    const edgeRows = this.db
      .prepare(
        `SELECT source, target, attrs FROM edges
         WHERE source IN (${placeholders})
           AND target IN (${placeholders})
           ${edgeTypeClause}`,
      )
      .all(...nodeIds, ...nodeIds) as Array<{
      source: string
      target: string
      attrs: string
    }>

    const edges = edgeRows.map(r => ({
      source: r.source,
      target: r.target,
      attrs: JSON.parse(r.attrs) as EdgeAttrs,
    }))

    return { nodes, edges, maxDepthReached }
  }

  // ==================== Subgraph / Serialization ====================

  async subgraph(nodeIds: string[]): Promise<SerializedGraph> {
    const nodes: Array<{ id: string, attrs: NodeAttrs }> = []
    for (const id of nodeIds) {
      const attrs = await this.getNode(id)
      if (attrs)
        nodes.push({ id, attrs })
    }

    const placeholders = nodeIds.map(() => '?').join(',')
    const edgeRows = this.db
      .prepare(
        `SELECT source, target, attrs FROM edges
         WHERE source IN (${placeholders}) AND target IN (${placeholders})`,
      )
      .all(...nodeIds, ...nodeIds) as Array<{
      source: string
      target: string
      attrs: string
    }>

    const edges = edgeRows.map(r => ({
      source: r.source,
      target: r.target,
      attrs: JSON.parse(r.attrs) as EdgeAttrs,
    }))

    return { nodes, edges }
  }

  async export(): Promise<SerializedGraph> {
    const nodeRows = this.db.prepare('SELECT id, attrs FROM nodes').all() as Array<{
      id: string
      attrs: string
    }>
    const edgeRows = this.db.prepare('SELECT source, target, attrs FROM edges').all() as Array<{
      source: string
      target: string
      attrs: string
    }>

    return {
      nodes: nodeRows.map(r => ({ id: r.id, attrs: JSON.parse(r.attrs) })),
      edges: edgeRows.map(r => ({
        source: r.source,
        target: r.target,
        attrs: JSON.parse(r.attrs),
      })),
    }
  }

  async import(data: SerializedGraph): Promise<void> {
    const insertNode = this.db.prepare('INSERT OR REPLACE INTO nodes (id, attrs) VALUES (?, ?)')
    const insertEdge = this.db.prepare(
      'INSERT OR REPLACE INTO edges (source, target, type, attrs) VALUES (?, ?, ?, ?)',
    )

    const transaction = this.db.transaction(() => {
      for (const node of data.nodes) {
        insertNode.run(node.id, JSON.stringify(node.attrs))
      }
      for (const edge of data.edges) {
        insertEdge.run(edge.source, edge.target, edge.attrs.type, JSON.stringify(edge.attrs))
      }
    })

    transaction()
  }

  /** Expose the underlying DB for shared-connection use (e.g., SQLiteTextSearchStore) */
  getDatabase(): InstanceType<typeof Database> {
    return this.db
  }
}
