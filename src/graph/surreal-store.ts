import type {
  DependencyEdge,
  Edge,
  EdgeType,
  FunctionalEdge,
  HighLevelNode,
  LowLevelNode,
  Node,
  StructuralMetadata,
} from './index'
import type { RPGConfig, SerializedRPG } from './rpg'
import type {
  EdgeFilter,
  GraphStats,
  GraphStore,
  NodeFilter,
  SearchHit,
  TraverseOptions,
  TraverseResult,
} from './store'
import { createNodeEngines } from '@surrealdb/node'
import { RecordId, Surreal, Table } from 'surrealdb'

const SCHEMA = `
DEFINE TABLE IF NOT EXISTS node SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS type ON node TYPE string ASSERT $value IN ['high_level', 'low_level'];
DEFINE FIELD IF NOT EXISTS feature_desc ON node TYPE string;
DEFINE FIELD IF NOT EXISTS feature_keywords ON node TYPE option<array<string>>;
DEFINE FIELD IF NOT EXISTS feature_sub ON node TYPE option<array<string>>;
DEFINE FIELD IF NOT EXISTS entity_type ON node TYPE option<string>;
DEFINE FIELD IF NOT EXISTS path ON node TYPE option<string>;
DEFINE FIELD IF NOT EXISTS qualified_name ON node TYPE option<string>;
DEFINE FIELD IF NOT EXISTS language ON node TYPE option<string>;
DEFINE FIELD IF NOT EXISTS line_start ON node TYPE option<int>;
DEFINE FIELD IF NOT EXISTS line_end ON node TYPE option<int>;
DEFINE FIELD IF NOT EXISTS directory_path ON node TYPE option<string>;
DEFINE FIELD IF NOT EXISTS source_code ON node TYPE option<string>;
DEFINE FIELD IF NOT EXISTS extra ON node TYPE option<object>;

DEFINE TABLE IF NOT EXISTS functional SCHEMAFULL TYPE RELATION FROM node TO node;
DEFINE FIELD IF NOT EXISTS level ON functional TYPE option<int>;
DEFINE FIELD IF NOT EXISTS sibling_order ON functional TYPE option<int>;
DEFINE FIELD IF NOT EXISTS weight ON functional TYPE option<float>;

DEFINE TABLE IF NOT EXISTS dependency SCHEMAFULL TYPE RELATION FROM node TO node;
DEFINE FIELD IF NOT EXISTS dep_type ON dependency TYPE option<string>;
DEFINE FIELD IF NOT EXISTS is_runtime ON dependency TYPE option<bool>;
DEFINE FIELD IF NOT EXISTS dep_line ON dependency TYPE option<int>;
DEFINE FIELD IF NOT EXISTS weight ON dependency TYPE option<float>;

DEFINE ANALYZER IF NOT EXISTS feature_analyzer TOKENIZERS blank, class FILTERS lowercase, ascii, snowball(english);
DEFINE INDEX IF NOT EXISTS ft_feature ON node FIELDS feature_desc SEARCH ANALYZER feature_analyzer BM25;
DEFINE INDEX IF NOT EXISTS ft_path ON node FIELDS path SEARCH ANALYZER feature_analyzer BM25;
`

/**
 * SurrealStore - GraphStore implementation using SurrealDB
 *
 * Uses SurrealDB's native graph relations for edge storage and traversal,
 * and BM25 full-text search for feature matching.
 *
 * Dependencies: surrealdb + @surrealdb/node (embedded engine).
 */
export class SurrealStore implements GraphStore {
  private db!: Surreal

  // ==================== Lifecycle ====================

  async open(path: string): Promise<void> {
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

  async addNode(node: Node): Promise<void> {
    await this.db.create(new RecordId('node', node.id)).content(this.nodeToContent(node))
  }

  async getNode(id: string): Promise<Node | null> {
    const record = await this.db.select<NodeRecord>(new RecordId('node', id))
    if (!record)
      return null
    return this.recordToNode(record)
  }

  async hasNode(id: string): Promise<boolean> {
    const record = await this.db.select(new RecordId('node', id))
    return record !== undefined
  }

  async updateNode(id: string, updates: Partial<Node>): Promise<void> {
    const sets: Record<string, unknown> = {}

    if (updates.feature) {
      if (updates.feature.description !== undefined)
        sets.feature_desc = updates.feature.description
      if (updates.feature.keywords !== undefined)
        sets.feature_keywords = updates.feature.keywords
      if (updates.feature.subFeatures !== undefined)
        sets.feature_sub = updates.feature.subFeatures
    }
    if (updates.metadata) {
      if (updates.metadata.entityType !== undefined)
        sets.entity_type = updates.metadata.entityType
      if (updates.metadata.path !== undefined)
        sets.path = updates.metadata.path
      if (updates.metadata.qualifiedName !== undefined)
        sets.qualified_name = updates.metadata.qualifiedName
      if (updates.metadata.startLine !== undefined)
        sets.line_start = updates.metadata.startLine
      if (updates.metadata.endLine !== undefined)
        sets.line_end = updates.metadata.endLine
    }

    if (Object.keys(sets).length === 0)
      return

    // Build UPDATE ... SET query dynamically
    const setParts = Object.keys(sets).map(key => `${key} = $${key}`)
    await this.db
      .query(`UPDATE $id SET ${setParts.join(', ')}`, {
        id: new RecordId('node', id),
        ...sets,
      })
      .collect()
  }

  async removeNode(id: string): Promise<void> {
    await this.db.delete(new RecordId('node', id))
  }

  async getNodes(filter?: NodeFilter): Promise<Node[]> {
    let sql = 'SELECT * FROM node'
    const conditions: string[] = []
    const bindings: Record<string, unknown> = {}

    if (filter?.type) {
      conditions.push('type = $type')
      bindings.type = filter.type
    }
    if (filter?.entityType) {
      conditions.push('entity_type = $entity_type')
      bindings.entity_type = filter.entityType
    }
    if (filter?.path) {
      conditions.push('path = $path')
      bindings.path = filter.path
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`
    }

    const [rows] = await this.db.query<[NodeRecord[]]>(sql, bindings).collect()
    return rows.map(r => this.recordToNode(r))
  }

  // ==================== Edge CRUD ====================

  async addEdge(edge: Edge): Promise<void> {
    const from = new RecordId('node', edge.source)
    const to = new RecordId('node', edge.target)

    if (edge.type === 'functional') {
      const fEdge = edge as FunctionalEdge
      const data: Record<string, unknown> = {}
      if (fEdge.level != null)
        data.level = fEdge.level
      if (fEdge.siblingOrder != null)
        data.sibling_order = fEdge.siblingOrder
      if (fEdge.weight != null)
        data.weight = fEdge.weight
      await this.db.relate(from, new Table('functional'), to, data)
    }
    else {
      const dEdge = edge as DependencyEdge
      const data: Record<string, unknown> = {}
      if (dEdge.dependencyType)
        data.dep_type = dEdge.dependencyType
      if (dEdge.isRuntime != null)
        data.is_runtime = dEdge.isRuntime
      if (dEdge.line != null)
        data.dep_line = dEdge.line
      if (dEdge.weight != null)
        data.weight = dEdge.weight
      await this.db.relate(from, new Table('dependency'), to, data)
    }
  }

  async removeEdge(source: string, target: string, type: EdgeType): Promise<void> {
    const table = type === 'functional' ? 'functional' : 'dependency'
    await this.db
      .query(`DELETE FROM ${table} WHERE in = $from AND out = $to`, {
        from: new RecordId('node', source),
        to: new RecordId('node', target),
      })
      .collect()
  }

  async getEdges(filter?: EdgeFilter): Promise<Edge[]> {
    const results: Edge[] = []
    const types: EdgeType[] = filter?.type ? [filter.type] : ['functional', 'dependency']

    for (const type of types) {
      let sql = `SELECT * FROM ${type}`
      const conditions: string[] = []
      const bindings: Record<string, unknown> = {}

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
      results.push(...rows.map(r => this.recordToEdge(r, type)))
    }

    return results
  }

  async getOutEdges(nodeId: string, type?: EdgeType): Promise<Edge[]> {
    return this.getEdges({ source: nodeId, type })
  }

  async getInEdges(nodeId: string, type?: EdgeType): Promise<Edge[]> {
    return this.getEdges({ target: nodeId, type })
  }

  // ==================== Graph Navigation ====================

  async getChildren(nodeId: string): Promise<Node[]> {
    // Query functional edges from this node, ordered by sibling_order
    const [refs] = await this.db
      .query<[Array<{ out: RecordId | string, sibling_order: number | null }>]>(
        'SELECT out, sibling_order FROM functional WHERE in = $id ORDER BY sibling_order',
        { id: new RecordId('node', nodeId) },
      )
      .collect()

    const nodes: Node[] = []
    for (const ref of refs) {
      const node = await this.getNode(this.extractId(ref.out))
      if (node)
        nodes.push(node)
    }
    return nodes
  }

  async getParent(nodeId: string): Promise<Node | null> {
    const [refs] = await this.db
      .query<[Array<{ in: RecordId | string }>]>(
        'SELECT in FROM functional WHERE out = $id LIMIT 1',
        { id: new RecordId('node', nodeId) },
      )
      .collect()

    const first = refs[0]
    if (!first)
      return null
    return this.getNode(this.extractId(first.in))
  }

  async getDependencies(nodeId: string): Promise<Node[]> {
    const [refs] = await this.db
      .query<[Array<{ out: RecordId | string }>]>('SELECT out FROM dependency WHERE in = $id', {
        id: new RecordId('node', nodeId),
      })
      .collect()

    const nodes: Node[] = []
    for (const ref of refs) {
      const node = await this.getNode(this.extractId(ref.out))
      if (node)
        nodes.push(node)
    }
    return nodes
  }

  async getDependents(nodeId: string): Promise<Node[]> {
    const [refs] = await this.db
      .query<[Array<{ in: RecordId | string }>]>('SELECT in FROM dependency WHERE out = $id', {
        id: new RecordId('node', nodeId),
      })
      .collect()

    const nodes: Node[] = []
    for (const ref of refs) {
      const node = await this.getNode(this.extractId(ref.in))
      if (node)
        nodes.push(node)
    }
    return nodes
  }

  // ==================== Deep Traversal ====================

  async traverse(options: TraverseOptions): Promise<TraverseResult> {
    const { startNode, edgeType, direction, maxDepth } = options

    const visited = new Set<string>([startNode])
    const nodes: Node[] = []
    const edges: Array<{ source: string, target: string, type: string, depType?: string }> = []
    let maxDepthReached = 0
    let frontier = [startNode]

    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
      const nextFrontier: string[] = []
      const tables = edgeType === 'both' ? ['functional', 'dependency'] : [edgeType]

      for (const table of tables) {
        const frontierIds = frontier.map(id => new RecordId('node', id))

        if (direction === 'out' || direction === 'both') {
          const [outEdges] = await this.db
            .query<[EdgeRecord[]]>(`SELECT * FROM ${table} WHERE in IN $ids`, {
              ids: frontierIds,
            })
            .collect()

          for (const edge of outEdges) {
            const targetId = this.extractId(edge.out)
            if (
              !visited.has(targetId)
              && (!options.depTypeFilter || edge.dep_type === options.depTypeFilter)
            ) {
              visited.add(targetId)
              nextFrontier.push(targetId)
              edges.push({
                source: this.extractId(edge.in),
                target: targetId,
                type: table,
                depType: edge.dep_type ?? undefined,
              })
            }
          }
        }

        if (direction === 'in' || direction === 'both') {
          const [inEdges] = await this.db
            .query<[EdgeRecord[]]>(`SELECT * FROM ${table} WHERE out IN $ids`, {
              ids: frontierIds,
            })
            .collect()

          for (const edge of inEdges) {
            const sourceId = this.extractId(edge.in)
            if (
              !visited.has(sourceId)
              && (!options.depTypeFilter || edge.dep_type === options.depTypeFilter)
            ) {
              visited.add(sourceId)
              nextFrontier.push(sourceId)
              edges.push({
                source: sourceId,
                target: this.extractId(edge.out),
                type: table,
                depType: edge.dep_type ?? undefined,
              })
            }
          }
        }
      }

      if (nextFrontier.length > 0) {
        maxDepthReached = depth
        // Batch fetch all new nodes
        const newNodeIds = nextFrontier.map(id => new RecordId('node', id))
        const [newNodes] = await this.db
          .query<[NodeRecord[]]>('SELECT * FROM node WHERE id IN $ids', { ids: newNodeIds })
          .collect()

        for (const record of newNodes) {
          const node = this.recordToNode(record)
          if (!options.entityTypeFilter || node.metadata?.entityType === options.entityTypeFilter) {
            nodes.push(node)
          }
        }
      }

      frontier = nextFrontier
    }

    return { nodes, edges, maxDepthReached }
  }

  // ==================== Search ====================

  async searchByFeature(query: string, scopes?: string[]): Promise<SearchHit[]> {
    if (scopes && scopes.length > 0) {
      // BFS to collect all descendant node IDs within the scope subtrees
      const subtreeIds = new Set<string>()
      const queue = [...scopes]

      while (queue.length > 0) {
        const batch = queue.splice(0, queue.length)
        const batchIds = batch.filter(id => !subtreeIds.has(id))
        for (const id of batchIds) subtreeIds.add(id)

        if (batchIds.length === 0)
          break

        const batchRids = batchIds.map(id => new RecordId('node', id))
        const [childRefs] = await this.db
          .query<[Array<{ out: RecordId | string }>]>(
            'SELECT out FROM functional WHERE in IN $ids',
            { ids: batchRids },
          )
          .collect()

        for (const ref of childRefs) {
          const childId = this.extractId(ref.out)
          if (!subtreeIds.has(childId)) {
            queue.push(childId)
          }
        }
      }

      if (subtreeIds.size === 0)
        return []

      const subtreeRids = [...subtreeIds].map(id => new RecordId('node', id))
      const [rows] = await this.db
        .query<[Array<NodeRecord & { score: number }>]>(
          `SELECT *, search::score(1) AS score FROM node
           WHERE feature_desc @1@ $query AND id IN $ids
           ORDER BY score DESC LIMIT 50`,
          { query, ids: subtreeRids },
        )
        .collect()

      return rows.map(r => ({
        node: this.recordToNode(r),
        score: r.score,
      }))
    }

    const [rows] = await this.db
      .query<[Array<NodeRecord & { score: number }>]>(
        `SELECT *, search::score(1) AS score FROM node
         WHERE feature_desc @1@ $query
         ORDER BY score DESC LIMIT 50`,
        { query },
      )
      .collect()

    return rows.map(r => ({
      node: this.recordToNode(r),
      score: r.score,
    }))
  }

  async searchByPath(pattern: string): Promise<Node[]> {
    const [rows] = await this.db
      .query<[NodeRecord[]]>('SELECT * FROM node WHERE path != NONE')
      .collect()

    // Convert glob pattern to regex and filter in application code
    const regex = new RegExp(pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'))
    return rows.filter(r => r.path && regex.test(r.path)).map(r => this.recordToNode(r))
  }

  // ==================== Ordering ====================

  async getTopologicalOrder(): Promise<Node[]> {
    // Kahn's algorithm in application code
    const [allNodes] = await this.db.query<[NodeRecord[]]>('SELECT * FROM node').collect()
    const [depEdges] = await this.db.query<[EdgeRecord[]]>('SELECT * FROM dependency').collect()

    // Build in-degree map (dependency edges: in -> out means "in depends on out")
    const inDegree = new Map<string, number>()
    const adjList = new Map<string, string[]>()

    for (const record of allNodes) {
      const id = this.extractId(record.id)
      inDegree.set(id, 0)
      adjList.set(id, [])
    }

    for (const edge of depEdges) {
      const source = this.extractId(edge.in)
      const target = this.extractId(edge.out)
      inDegree.set(target, (inDegree.get(target) ?? 0) + 1)
      adjList.get(source)?.push(target)
    }

    // BFS from nodes with in-degree 0
    const queue: string[] = []
    for (const [id, deg] of inDegree) {
      if (deg === 0)
        queue.push(id)
    }

    const ordered: Node[] = []
    const nodeMap = new Map(allNodes.map(r => [this.extractId(r.id), this.recordToNode(r)]))

    while (queue.length > 0) {
      const nodeId = queue.shift()!
      const node = nodeMap.get(nodeId)
      if (node)
        ordered.push(node)

      for (const neighbor of adjList.get(nodeId) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1
        inDegree.set(neighbor, newDegree)
        if (newDegree === 0)
          queue.push(neighbor)
      }
    }

    return ordered
  }

  // ==================== Statistics ====================

  async getStats(): Promise<GraphStats> {
    const [nodeCount, funcCount, depCount, hlCount, llCount] = await this.db
      .query<
      [
        Array<{ count: number }>,
        Array<{ count: number }>,
        Array<{ count: number }>,
        Array<{ count: number }>,
        Array<{ count: number }>,
      ]
    >(
        `SELECT count() AS count FROM node GROUP ALL;
         SELECT count() AS count FROM functional GROUP ALL;
         SELECT count() AS count FROM dependency GROUP ALL;
         SELECT count() AS count FROM node WHERE type = 'high_level' GROUP ALL;
         SELECT count() AS count FROM node WHERE type = 'low_level' GROUP ALL;`,
      )
      .collect()

    return {
      nodeCount: nodeCount[0]?.count ?? 0,
      edgeCount: (funcCount[0]?.count ?? 0) + (depCount[0]?.count ?? 0),
      highLevelNodeCount: hlCount[0]?.count ?? 0,
      lowLevelNodeCount: llCount[0]?.count ?? 0,
      functionalEdgeCount: funcCount[0]?.count ?? 0,
      dependencyEdgeCount: depCount[0]?.count ?? 0,
    }
  }

  // ==================== Serialization ====================

  async importJSON(data: SerializedRPG): Promise<void> {
    // Insert nodes
    for (const nodeData of data.nodes) {
      const node = nodeData as Node
      await this.addNode(node)
    }

    // Insert edges
    for (const edgeData of data.edges) {
      const edge = edgeData as Edge
      await this.addEdge(edge)
    }
  }

  async exportJSON(config: RPGConfig): Promise<SerializedRPG> {
    const nodes = await this.getNodes()
    const edges = await this.getEdges()

    return {
      version: '1.0.0',
      config,
      nodes,
      edges,
    }
  }

  // ==================== Internal Helpers ====================

  private extractId(recordId: unknown): string {
    if (recordId instanceof RecordId) {
      return recordId.id as string
    }
    // Fallback: parse "table:id" string format
    const str = String(recordId)
    const colonIndex = str.indexOf(':')
    return colonIndex >= 0 ? str.slice(colonIndex + 1) : str
  }

  private recordToNode(record: NodeRecord): Node {
    const id = this.extractId(record.id)

    const feature = {
      description: record.feature_desc,
      keywords: record.feature_keywords ?? undefined,
      subFeatures: record.feature_sub ?? undefined,
    }

    const metadata
      = record.entity_type || record.path
        ? {
            entityType: (record.entity_type as StructuralMetadata['entityType']) ?? undefined,
            path: record.path ?? undefined,
            qualifiedName: record.qualified_name ?? undefined,
            language: record.language ?? undefined,
            startLine: record.line_start ?? undefined,
            endLine: record.line_end ?? undefined,
            extra: record.extra ?? undefined,
          }
        : undefined

    if (record.type === 'high_level') {
      return {
        id,
        type: 'high_level' as const,
        feature,
        metadata,
        directoryPath: record.directory_path ?? undefined,
      } satisfies HighLevelNode
    }

    return {
      id,
      type: 'low_level' as const,
      feature,
      metadata: metadata ?? {},
      sourceCode: record.source_code ?? undefined,
    } satisfies LowLevelNode
  }

  private nodeToContent(node: Node): Record<string, unknown> {
    const content: Record<string, unknown> = {
      type: node.type,
      feature_desc: node.feature.description,
    }

    if (node.feature.keywords)
      content.feature_keywords = node.feature.keywords
    if (node.feature.subFeatures)
      content.feature_sub = node.feature.subFeatures
    if (node.metadata?.entityType)
      content.entity_type = node.metadata.entityType
    if (node.metadata?.path)
      content.path = node.metadata.path
    if (node.metadata?.qualifiedName)
      content.qualified_name = node.metadata.qualifiedName
    if (node.metadata?.language)
      content.language = node.metadata.language
    if (node.metadata?.startLine != null)
      content.line_start = node.metadata.startLine
    if (node.metadata?.endLine != null)
      content.line_end = node.metadata.endLine
    if (node.metadata?.extra)
      content.extra = node.metadata.extra

    if (node.type === 'high_level' && (node as HighLevelNode).directoryPath) {
      content.directory_path = (node as HighLevelNode).directoryPath
    }
    if (node.type === 'low_level' && (node as LowLevelNode).sourceCode) {
      content.source_code = (node as LowLevelNode).sourceCode
    }

    return content
  }

  private recordToEdge(record: EdgeRecord, type: EdgeType): Edge {
    const source = this.extractId(record.in)
    const target = this.extractId(record.out)

    if (type === 'functional') {
      return {
        source,
        target,
        type: 'functional' as const,
        level: record.level ?? undefined,
        siblingOrder: record.sibling_order ?? undefined,
        weight: record.weight ?? undefined,
      }
    }

    return {
      source,
      target,
      type: 'dependency' as const,
      dependencyType: (record.dep_type ?? 'use') as
      | 'import'
      | 'call'
      | 'inherit'
      | 'implement'
      | 'use',
      isRuntime: record.is_runtime ?? undefined,
      line: record.dep_line ?? undefined,
      weight: record.weight ?? undefined,
    }
  }
}

// ==================== Record Types ====================

interface NodeRecord {
  id: RecordId | string
  type: string
  feature_desc: string
  feature_keywords: string[] | null
  feature_sub: string[] | null
  entity_type: string | null
  path: string | null
  qualified_name: string | null
  language: string | null
  line_start: number | null
  line_end: number | null
  directory_path: string | null
  source_code: string | null
  extra: Record<string, unknown> | null
}

interface EdgeRecord {
  id: RecordId | string
  in: RecordId | string
  out: RecordId | string
  level?: number | null
  sibling_order?: number | null
  dep_type?: string | null
  is_runtime?: boolean | null
  dep_line?: number | null
  weight?: number | null
}
