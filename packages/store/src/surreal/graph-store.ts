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
import { createNodeEngines } from '@surrealdb/node'
import { RecordId, Surreal, Table } from 'surrealdb'

const SCHEMA = `
DEFINE TABLE IF NOT EXISTS node SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS attrs ON node FLEXIBLE TYPE object;

DEFINE TABLE IF NOT EXISTS edge SCHEMAFULL TYPE RELATION FROM node TO node;
DEFINE FIELD IF NOT EXISTS type ON edge TYPE string;
DEFINE FIELD IF NOT EXISTS attrs ON edge FLEXIBLE TYPE object;
`

interface NodeRecord {
  id: RecordId | string
  attrs: NodeAttrs
}

interface EdgeRecord {
  id: RecordId | string
  in: RecordId | string
  out: RecordId | string
  type: string
  attrs: EdgeAttrs
}

/**
 * SurrealGraphStore — GraphStore implementation using SurrealDB embedded engine.
 *
 * Stores nodes and edges as generic attrs objects.
 */
export class SurrealGraphStore implements GraphStore {
  private db!: Surreal

  async open(config: unknown): Promise<void> {
    const path = config as string
    this.db = new Surreal({ engines: createNodeEngines() })
    const url = path === 'memory' ? 'mem://' : `surrealkv://${path}`
    await this.db.connect(url)
    await this.db.use({ namespace: 'rpg', database: 'main' })
    await this.db.query(SCHEMA).collect()
  }

  async close(): Promise<void> {
    await this.db.close()
  }

  // ==================== Node CRUD ====================

  async addNode(id: string, attrs: NodeAttrs): Promise<void> {
    await this.db.create(new RecordId('node', id)).content({ attrs })
  }

  async getNode(id: string): Promise<NodeAttrs | null> {
    const record = await this.db.select<NodeRecord>(new RecordId('node', id))
    if (!record)
      return null
    return record.attrs
  }

  async hasNode(id: string): Promise<boolean> {
    const record = await this.db.select(new RecordId('node', id))
    return record !== undefined
  }

  async updateNode(id: string, patch: Partial<NodeAttrs>): Promise<void> {
    const existing = await this.getNode(id)
    if (!existing)
      return
    const merged = { ...existing, ...patch }
    await this.db
      .query('UPDATE $id SET attrs = $attrs', {
        id: new RecordId('node', id),
        attrs: merged,
      })
      .collect()
  }

  async removeNode(id: string): Promise<void> {
    await this.db.delete(new RecordId('node', id))
  }

  async getNodes(filter?: NodeFilter): Promise<Array<{ id: string, attrs: NodeAttrs }>> {
    const [rows] = await this.db.query<[NodeRecord[]]>('SELECT * FROM node').collect()
    let results = rows.map(r => ({ id: this.extractId(r.id), attrs: r.attrs }))

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
    const from = new RecordId('node', source)
    const to = new RecordId('node', target)
    await this.db.relate(from, new Table('edge'), to, { type: attrs.type, attrs })
  }

  async removeEdge(source: string, target: string, type: string): Promise<void> {
    await this.db
      .query('DELETE FROM edge WHERE in = $from AND out = $to AND type = $type', {
        from: new RecordId('node', source),
        to: new RecordId('node', target),
        type,
      })
      .collect()
  }

  async getEdges(
    filter?: EdgeFilter,
  ): Promise<Array<{ source: string, target: string, attrs: EdgeAttrs }>> {
    let sql = 'SELECT * FROM edge'
    const conditions: string[] = []
    const bindings: Record<string, unknown> = {}

    if (filter?.type) {
      conditions.push('type = $type')
      bindings.type = filter.type
    }
    if (filter?.source) {
      conditions.push('in = $from')
      bindings.from = new RecordId('node', filter.source)
    }
    if (filter?.target) {
      conditions.push('out = $to')
      bindings.to = new RecordId('node', filter.target)
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`
    }

    const [rows] = await this.db.query<[EdgeRecord[]]>(sql, bindings).collect()
    return rows.map(r => ({
      source: this.extractId(r.in),
      target: this.extractId(r.out),
      attrs: r.attrs,
    }))
  }

  // ==================== Neighbor Queries ====================

  async getNeighbors(
    id: string,
    direction: 'in' | 'out' | 'both',
    edgeType?: string,
  ): Promise<string[]> {
    const results = new Set<string>()
    const typeClause = edgeType ? ' AND type = $type' : ''
    const bindings: Record<string, unknown> = {
      id: new RecordId('node', id),
    }
    if (edgeType)
      bindings.type = edgeType

    if (direction === 'out' || direction === 'both') {
      const [rows] = await this.db
        .query<[Array<{ out: RecordId | string }>]>(
          `SELECT out FROM edge WHERE in = $id${typeClause}`,
          bindings,
        )
        .collect()
      for (const r of rows) results.add(this.extractId(r.out))
    }

    if (direction === 'in' || direction === 'both') {
      const [rows] = await this.db
        .query<[Array<{ in: RecordId | string }>]>(
          `SELECT in FROM edge WHERE out = $id${typeClause}`,
          bindings,
        )
        .collect()
      for (const r of rows) results.add(this.extractId(r.in))
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
      const frontierIds = frontier.map(id => new RecordId('node', id))
      const typeClause = edgeType ? ' AND type = $type' : ''
      const bindings: Record<string, unknown> = { ids: frontierIds }
      if (edgeType)
        bindings.type = edgeType

      if (direction === 'out' || direction === 'both') {
        const [outEdges] = await this.db
          .query<[EdgeRecord[]]>(`SELECT * FROM edge WHERE in IN $ids${typeClause}`, bindings)
          .collect()

        for (const edge of outEdges) {
          const targetId = this.extractId(edge.out)
          if (!visited.has(targetId)) {
            visited.add(targetId)
            nextFrontier.push(targetId)
            edges.push({
              source: this.extractId(edge.in),
              target: targetId,
              attrs: edge.attrs,
            })
          }
        }
      }

      if (direction === 'in' || direction === 'both') {
        const [inEdges] = await this.db
          .query<[EdgeRecord[]]>(`SELECT * FROM edge WHERE out IN $ids${typeClause}`, bindings)
          .collect()

        for (const edge of inEdges) {
          const sourceId = this.extractId(edge.in)
          if (!visited.has(sourceId)) {
            visited.add(sourceId)
            nextFrontier.push(sourceId)
            edges.push({
              source: sourceId,
              target: this.extractId(edge.out),
              attrs: edge.attrs,
            })
          }
        }
      }

      if (nextFrontier.length > 0) {
        maxDepthReached = depth
        const newNodeIds = nextFrontier.map(id => new RecordId('node', id))
        const [newNodes] = await this.db
          .query<[NodeRecord[]]>('SELECT * FROM node WHERE id IN $ids', { ids: newNodeIds })
          .collect()

        for (const record of newNodes) {
          const nodeAttrs = record.attrs
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
            nodes.push({ id: this.extractId(record.id), attrs: nodeAttrs })
          }
        }
      }

      frontier = nextFrontier
    }

    return { nodes, edges, maxDepthReached }
  }

  // ==================== Subgraph / Serialization ====================

  async subgraph(nodeIds: string[]): Promise<SerializedGraph> {
    const rids = nodeIds.map(id => new RecordId('node', id))

    const [nodeRows] = await this.db
      .query<[NodeRecord[]]>('SELECT * FROM node WHERE id IN $ids', { ids: rids })
      .collect()

    const [edgeRows] = await this.db
      .query<[EdgeRecord[]]>('SELECT * FROM edge WHERE in IN $ids AND out IN $ids', { ids: rids })
      .collect()

    return {
      nodes: nodeRows.map(r => ({ id: this.extractId(r.id), attrs: r.attrs })),
      edges: edgeRows.map(r => ({
        source: this.extractId(r.in),
        target: this.extractId(r.out),
        attrs: r.attrs,
      })),
    }
  }

  async export(): Promise<SerializedGraph> {
    const [nodeRows] = await this.db.query<[NodeRecord[]]>('SELECT * FROM node').collect()
    const [edgeRows] = await this.db.query<[EdgeRecord[]]>('SELECT * FROM edge').collect()

    return {
      nodes: nodeRows.map(r => ({ id: this.extractId(r.id), attrs: r.attrs })),
      edges: edgeRows.map(r => ({
        source: this.extractId(r.in),
        target: this.extractId(r.out),
        attrs: r.attrs,
      })),
    }
  }

  async import(data: SerializedGraph): Promise<void> {
    for (const node of data.nodes) {
      await this.addNode(node.id, node.attrs)
    }
    for (const edge of data.edges) {
      await this.addEdge(edge.source, edge.target, edge.attrs)
    }
  }

  private extractId(recordId: unknown): string {
    if (recordId instanceof RecordId) {
      return recordId.id as string
    }
    const str = String(recordId)
    const colonIndex = str.indexOf(':')
    return colonIndex >= 0 ? str.slice(colonIndex + 1) : str
  }
}
