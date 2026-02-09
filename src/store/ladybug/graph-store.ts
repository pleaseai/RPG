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
import lbug from 'lbug'

// Global refs prevent GC from collecting native objects during worker exit
const _liveRefs: unknown[] = []

/**
 * LadybugGraphStore — GraphStore implementation using LadybugDB (Cypher).
 *
 * Stores nodes as (id, JSON attrs) and edges as (source, target, edge_type, JSON attrs).
 * Uses application-level BFS for traversal (following SurrealGraphStore pattern).
 */
export class LadybugGraphStore implements GraphStore {
  private db!: InstanceType<typeof lbug.Database>
  private conn!: InstanceType<typeof lbug.Connection>

  async open(config: unknown): Promise<void> {
    const path = config as string
    this.db = new lbug.Database(path === 'memory' ? ':memory:' : path)
    this.conn = new lbug.Connection(this.db)
    // Pin native objects to prevent GC segfault during process exit
    _liveRefs.push(this.db, this.conn)
    await this.conn.query('CREATE NODE TABLE IF NOT EXISTS GNode(id STRING PRIMARY KEY, attrs STRING)')
    await this.conn.query('CREATE REL TABLE IF NOT EXISTS GEdge(FROM GNode TO GNode, edge_type STRING, attrs STRING)')
  }

  async close(): Promise<void> {
    await this.conn.close()
    await this.db.close()
  }

  // ==================== Node CRUD ====================

  async addNode(id: string, attrs: NodeAttrs): Promise<void> {
    const stmt = await this.conn.prepare('CREATE (n:GNode {id: $id, attrs: $attrs})')
    await this.conn.execute(stmt, { id, attrs: JSON.stringify(attrs) })
  }

  async getNode(id: string): Promise<NodeAttrs | null> {
    const stmt = await this.conn.prepare('MATCH (n:GNode) WHERE n.id = $id RETURN n.attrs')
    const result = await this.conn.execute(stmt, { id })
    const rows = await result.getAll()
    if (rows.length === 0)
      return null
    return JSON.parse(rows[0]['n.attrs'] as string)
  }

  async hasNode(id: string): Promise<boolean> {
    const stmt = await this.conn.prepare('MATCH (n:GNode) WHERE n.id = $id RETURN n.id')
    const result = await this.conn.execute(stmt, { id })
    const rows = await result.getAll()
    return rows.length > 0
  }

  async updateNode(id: string, patch: Partial<NodeAttrs>): Promise<void> {
    const existing = await this.getNode(id)
    if (!existing)
      return
    const merged = { ...existing, ...patch }
    const stmt = await this.conn.prepare('MATCH (n:GNode) WHERE n.id = $id SET n.attrs = $attrs')
    await this.conn.execute(stmt, { id, attrs: JSON.stringify(merged) })
  }

  async removeNode(id: string): Promise<void> {
    const stmt = await this.conn.prepare('MATCH (n:GNode) WHERE n.id = $id DETACH DELETE n')
    await this.conn.execute(stmt, { id })
  }

  async getNodes(filter?: NodeFilter): Promise<Array<{ id: string, attrs: NodeAttrs }>> {
    const result = await this.conn.query('MATCH (n:GNode) RETURN n.id, n.attrs')
    const rows = await result.getAll()

    let results = rows.map(r => ({
      id: r['n.id'] as string,
      attrs: JSON.parse(r['n.attrs'] as string) as NodeAttrs,
    }))

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
    const stmt = await this.conn.prepare(
      `MATCH (s:GNode), (t:GNode)
       WHERE s.id = $src AND t.id = $tgt
       CREATE (s)-[:GEdge {edge_type: $type, attrs: $attrs}]->(t)`,
    )
    await this.conn.execute(stmt, {
      src: source,
      tgt: target,
      type: attrs.type,
      attrs: JSON.stringify(attrs),
    })
  }

  async removeEdge(source: string, target: string, type: string): Promise<void> {
    const stmt = await this.conn.prepare(
      `MATCH (s:GNode)-[r:GEdge]->(t:GNode)
       WHERE s.id = $src AND t.id = $tgt AND r.edge_type = $type
       DELETE r`,
    )
    await this.conn.execute(stmt, { src: source, tgt: target, type })
  }

  async getEdges(
    filter?: EdgeFilter,
  ): Promise<Array<{ source: string, target: string, attrs: EdgeAttrs }>> {
    const conditions: string[] = []
    const params: Record<string, unknown> = {}

    if (filter?.type) {
      conditions.push('r.edge_type = $type')
      params.type = filter.type
    }
    if (filter?.source) {
      conditions.push('s.id = $src')
      params.src = filter.source
    }
    if (filter?.target) {
      conditions.push('t.id = $tgt')
      params.tgt = filter.target
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const query = `MATCH (s:GNode)-[r:GEdge]->(t:GNode) ${where} RETURN s.id, t.id, r.attrs`

    let result
    if (Object.keys(params).length > 0) {
      const stmt = await this.conn.prepare(query)
      result = await this.conn.execute(stmt, params)
    }
    else {
      result = await this.conn.query(query)
    }

    const rows = await result.getAll()
    return rows.map(r => ({
      source: r['s.id'] as string,
      target: r['t.id'] as string,
      attrs: JSON.parse(r['r.attrs'] as string) as EdgeAttrs,
    }))
  }

  // ==================== Neighbor Queries ====================

  async getNeighbors(
    id: string,
    direction: 'in' | 'out' | 'both',
    edgeType?: string,
  ): Promise<string[]> {
    const results = new Set<string>()
    const typeClause = edgeType ? ' AND r.edge_type = $type' : ''
    const params: Record<string, unknown> = { id }
    if (edgeType)
      params.type = edgeType

    if (direction === 'out' || direction === 'both') {
      const stmt = await this.conn.prepare(
        `MATCH (s:GNode)-[r:GEdge]->(t:GNode) WHERE s.id = $id${typeClause} RETURN t.id`,
      )
      const result = await this.conn.execute(stmt, params)
      const rows = await result.getAll()
      for (const r of rows) results.add(r['t.id'] as string)
    }

    if (direction === 'in' || direction === 'both') {
      const stmt = await this.conn.prepare(
        `MATCH (s:GNode)-[r:GEdge]->(t:GNode) WHERE t.id = $id${typeClause} RETURN s.id`,
      )
      const result = await this.conn.execute(stmt, params)
      const rows = await result.getAll()
      for (const r of rows) results.add(r['s.id'] as string)
    }

    return [...results]
  }

  // ==================== Graph Traversal ====================

  async traverse(startId: string, opts: TraverseOpts): Promise<TraverseResult> {
    const { direction, maxDepth, edgeType } = opts

    const visited = new Set<string>([startId])
    const nodes: Array<{ id: string, attrs: NodeAttrs }> = []
    const edges: Array<{ source: string, target: string, attrs: EdgeAttrs }> = []
    let maxDepthReached = 0
    let frontier = [startId]

    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
      const nextFrontier: string[] = []
      const typeClause = edgeType ? ' AND r.edge_type = $type' : ''
      const params: Record<string, unknown> = {}
      if (edgeType)
        params.type = edgeType

      // Build ID list for frontier - use OR chain since IN with list may not work
      const idConditions = frontier.map((_, i) => `s.id = $fid${i}`)
      frontier.forEach((fid, i) => { params[`fid${i}`] = fid })

      if (direction === 'out' || direction === 'both') {
        const stmt = await this.conn.prepare(
          `MATCH (s:GNode)-[r:GEdge]->(t:GNode) WHERE (${idConditions.join(' OR ')})${typeClause} RETURN s.id, t.id, r.attrs`,
        )
        const result = await this.conn.execute(stmt, params)
        const rows = await result.getAll()

        for (const row of rows) {
          const targetId = row['t.id'] as string
          if (!visited.has(targetId)) {
            visited.add(targetId)
            nextFrontier.push(targetId)
            edges.push({
              source: row['s.id'] as string,
              target: targetId,
              attrs: JSON.parse(row['r.attrs'] as string) as EdgeAttrs,
            })
          }
        }
      }

      if (direction === 'in' || direction === 'both') {
        // For incoming edges, we need to match where the target is in frontier
        const inIdConditions = frontier.map((_, i) => `t.id = $fid${i}`)
        const stmt = await this.conn.prepare(
          `MATCH (s:GNode)-[r:GEdge]->(t:GNode) WHERE (${inIdConditions.join(' OR ')})${typeClause} RETURN s.id, t.id, r.attrs`,
        )
        const result = await this.conn.execute(stmt, params)
        const rows = await result.getAll()

        for (const row of rows) {
          const sourceId = row['s.id'] as string
          if (!visited.has(sourceId)) {
            visited.add(sourceId)
            nextFrontier.push(sourceId)
            edges.push({
              source: sourceId,
              target: row['t.id'] as string,
              attrs: JSON.parse(row['r.attrs'] as string) as EdgeAttrs,
            })
          }
        }
      }

      if (nextFrontier.length > 0) {
        maxDepthReached = depth
        // Fetch node attrs for new frontier
        for (const nodeId of nextFrontier) {
          const nodeAttrs = await this.getNode(nodeId)
          if (nodeAttrs) {
            let matches = true
            if (opts.filter) {
              for (const [key, value] of Object.entries(opts.filter)) {
                if (value !== undefined && nodeAttrs[key] !== value) {
                  matches = false
                  break
                }
              }
            }
            if (matches) {
              nodes.push({ id: nodeId, attrs: nodeAttrs })
            }
          }
        }
      }

      frontier = nextFrontier
    }

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

    // Get edges where both source and target are in nodeIds
    const nodeSet = new Set(nodeIds)
    const allEdges = await this.getEdges()
    const edges = allEdges.filter(e => nodeSet.has(e.source) && nodeSet.has(e.target))

    return { nodes, edges }
  }

  async export(): Promise<SerializedGraph> {
    const nodes = await this.getNodes()
    const edges = await this.getEdges()
    return { nodes, edges }
  }

  async import(data: SerializedGraph): Promise<void> {
    for (const node of data.nodes) {
      await this.addNode(node.id, node.attrs)
    }
    for (const edge of data.edges) {
      await this.addEdge(edge.source, edge.target, edge.attrs)
    }
  }
}
