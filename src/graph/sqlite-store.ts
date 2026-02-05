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
import Database from 'better-sqlite3'

type BindValue = string | number | null | undefined

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nodes (
    id              TEXT PRIMARY KEY,
    type            TEXT NOT NULL CHECK(type IN ('high_level', 'low_level')),
    feature_desc    TEXT NOT NULL,
    feature_keywords TEXT,
    feature_sub     TEXT,
    entity_type     TEXT,
    path            TEXT,
    qualified_name  TEXT,
    language        TEXT,
    line_start      INTEGER,
    line_end        INTEGER,
    directory_path  TEXT,
    source_code     TEXT,
    extra           TEXT,
    created_at      INTEGER DEFAULT (unixepoch()),
    updated_at      INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS edges (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    source  TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    target  TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    type    TEXT NOT NULL CHECK(type IN ('functional', 'dependency')),
    level         INTEGER,
    sibling_order INTEGER,
    dep_type      TEXT,
    is_runtime    INTEGER,
    dep_line      INTEGER,
    weight        REAL,
    UNIQUE(source, target, type)
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source, type);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target, type);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_path ON nodes(path);

CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    feature_desc,
    feature_keywords,
    path,
    qualified_name,
    content='nodes',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
    INSERT INTO nodes_fts(rowid, feature_desc, feature_keywords, path, qualified_name)
    VALUES (new.rowid, new.feature_desc, new.feature_keywords, new.path, new.qualified_name);
END;

CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, feature_desc, feature_keywords, path, qualified_name)
    VALUES('delete', old.rowid, old.feature_desc, old.feature_keywords, old.path, old.qualified_name);
END;

CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, feature_desc, feature_keywords, path, qualified_name)
    VALUES('delete', old.rowid, old.feature_desc, old.feature_keywords, old.path, old.qualified_name);
    INSERT INTO nodes_fts(rowid, feature_desc, feature_keywords, path, qualified_name)
    VALUES (new.rowid, new.feature_desc, new.feature_keywords, new.path, new.qualified_name);
END;
`

/**
 * SQLiteStore - GraphStore implementation using better-sqlite3
 *
 * Uses FTS5 for full-text search and recursive CTEs for graph traversal.
 */
export class SQLiteStore implements GraphStore {
  private db!: InstanceType<typeof Database>

  // ==================== Lifecycle ====================

  async open(path: string): Promise<void> {
    this.db = new Database(path === 'memory' ? ':memory:' : path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(SCHEMA)
  }

  async close(): Promise<void> {
    this.db.close()
  }

  // ==================== Node CRUD ====================

  async addNode(node: Node): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO nodes (id, type, feature_desc, feature_keywords, feature_sub,
        entity_type, path, qualified_name, language, line_start, line_end,
        directory_path, source_code, extra)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      node.id,
      node.type,
      node.feature.description,
      node.feature.keywords ? JSON.stringify(node.feature.keywords) : null,
      node.feature.subFeatures ? JSON.stringify(node.feature.subFeatures) : null,
      node.metadata?.entityType ?? null,
      node.metadata?.path ?? null,
      node.metadata?.qualifiedName ?? null,
      node.metadata?.language ?? null,
      node.metadata?.startLine ?? null,
      node.metadata?.endLine ?? null,
      node.type === 'high_level' ? ((node as HighLevelNode).directoryPath ?? null) : null,
      node.type === 'low_level' ? ((node as LowLevelNode).sourceCode ?? null) : null,
      node.metadata?.extra ? JSON.stringify(node.metadata.extra) : null,
    )
  }

  async getNode(id: string): Promise<Node | null> {
    const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as NodeRow | undefined
    return row ? this.rowToNode(row) : null
  }

  async hasNode(id: string): Promise<boolean> {
    const row = this.db.prepare('SELECT 1 FROM nodes WHERE id = ?').get(id)
    return row !== undefined
  }

  async updateNode(id: string, updates: Partial<Node>): Promise<void> {
    const sets: string[] = []
    const values: BindValue[] = []

    if (updates.feature) {
      if (updates.feature.description !== undefined) {
        sets.push('feature_desc = ?')
        values.push(updates.feature.description)
      }
      if (updates.feature.keywords !== undefined) {
        sets.push('feature_keywords = ?')
        values.push(JSON.stringify(updates.feature.keywords))
      }
      if (updates.feature.subFeatures !== undefined) {
        sets.push('feature_sub = ?')
        values.push(JSON.stringify(updates.feature.subFeatures))
      }
    }
    if (updates.metadata) {
      if (updates.metadata.entityType !== undefined) {
        sets.push('entity_type = ?')
        values.push(updates.metadata.entityType)
      }
      if (updates.metadata.path !== undefined) {
        sets.push('path = ?')
        values.push(updates.metadata.path)
      }
      if (updates.metadata.qualifiedName !== undefined) {
        sets.push('qualified_name = ?')
        values.push(updates.metadata.qualifiedName)
      }
      if (updates.metadata.startLine !== undefined) {
        sets.push('line_start = ?')
        values.push(updates.metadata.startLine)
      }
      if (updates.metadata.endLine !== undefined) {
        sets.push('line_end = ?')
        values.push(updates.metadata.endLine)
      }
    }

    if (sets.length === 0)
      return

    sets.push('updated_at = unixepoch()')
    values.push(id)

    this.db.prepare(`UPDATE nodes SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }

  async removeNode(id: string): Promise<void> {
    this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id)
  }

  async getNodes(filter?: NodeFilter): Promise<Node[]> {
    let sql = 'SELECT * FROM nodes'
    const conditions: string[] = []
    const values: BindValue[] = []

    if (filter?.type) {
      conditions.push('type = ?')
      values.push(filter.type)
    }
    if (filter?.entityType) {
      conditions.push('entity_type = ?')
      values.push(filter.entityType)
    }
    if (filter?.path) {
      conditions.push('path = ?')
      values.push(filter.path)
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`
    }

    const rows = this.db.prepare(sql).all(...values) as NodeRow[]
    return rows.map(r => this.rowToNode(r))
  }

  // ==================== Edge CRUD ====================

  async addEdge(edge: Edge): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO edges (source, target, type, level, sibling_order, dep_type, is_runtime, dep_line, weight)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      edge.source,
      edge.target,
      edge.type,
      edge.type === 'functional' ? ((edge as FunctionalEdge).level ?? null) : null,
      edge.type === 'functional' ? ((edge as FunctionalEdge).siblingOrder ?? null) : null,
      edge.type === 'dependency' ? ((edge as DependencyEdge).dependencyType ?? null) : null,
      edge.type === 'dependency' ? ((edge as DependencyEdge).isRuntime ? 1 : 0) : null,
      edge.type === 'dependency' ? ((edge as DependencyEdge).line ?? null) : null,
      edge.weight ?? null,
    )
  }

  async removeEdge(source: string, target: string, type: EdgeType): Promise<void> {
    this.db
      .prepare('DELETE FROM edges WHERE source = ? AND target = ? AND type = ?')
      .run(source, target, type)
  }

  async getEdges(filter?: EdgeFilter): Promise<Edge[]> {
    let sql = 'SELECT * FROM edges'
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

    const rows = this.db.prepare(sql).all(...values) as EdgeRow[]
    return rows.map(r => this.rowToEdge(r))
  }

  async getOutEdges(nodeId: string, type?: EdgeType): Promise<Edge[]> {
    const filter: EdgeFilter = { source: nodeId }
    if (type)
      filter.type = type
    return this.getEdges(filter)
  }

  async getInEdges(nodeId: string, type?: EdgeType): Promise<Edge[]> {
    const filter: EdgeFilter = { target: nodeId }
    if (type)
      filter.type = type
    return this.getEdges(filter)
  }

  // ==================== Graph Navigation ====================

  async getChildren(nodeId: string): Promise<Node[]> {
    const rows = this.db
      .prepare(
        `SELECT n.* FROM nodes n
         JOIN edges e ON e.target = n.id
         WHERE e.source = ? AND e.type = 'functional'
         ORDER BY e.sibling_order`,
      )
      .all(nodeId) as NodeRow[]
    return rows.map(r => this.rowToNode(r))
  }

  async getParent(nodeId: string): Promise<Node | null> {
    const row = this.db
      .prepare(
        `SELECT n.* FROM nodes n
         JOIN edges e ON e.source = n.id
         WHERE e.target = ? AND e.type = 'functional'
         LIMIT 1`,
      )
      .get(nodeId) as NodeRow | undefined
    return row ? this.rowToNode(row) : null
  }

  async getDependencies(nodeId: string): Promise<Node[]> {
    const rows = this.db
      .prepare(
        `SELECT n.* FROM nodes n
         JOIN edges e ON e.target = n.id
         WHERE e.source = ? AND e.type = 'dependency'`,
      )
      .all(nodeId) as NodeRow[]
    return rows.map(r => this.rowToNode(r))
  }

  async getDependents(nodeId: string): Promise<Node[]> {
    const rows = this.db
      .prepare(
        `SELECT n.* FROM nodes n
         JOIN edges e ON e.source = n.id
         WHERE e.target = ? AND e.type = 'dependency'`,
      )
      .all(nodeId) as NodeRow[]
    return rows.map(r => this.rowToNode(r))
  }

  // ==================== Deep Traversal ====================

  async traverse(options: TraverseOptions): Promise<TraverseResult> {
    const { startNode, edgeType, direction, maxDepth } = options

    const edgeTypeConditions: string[] = []
    if (edgeType === 'functional' || edgeType === 'both')
      edgeTypeConditions.push('\'functional\'')
    if (edgeType === 'dependency' || edgeType === 'both')
      edgeTypeConditions.push('\'dependency\'')
    const edgeTypeIn = edgeTypeConditions.join(', ')

    let directionClause: string
    if (direction === 'out') {
      directionClause = 'e.source = t.node_id'
    }
    else if (direction === 'in') {
      directionClause = 'e.target = t.node_id'
    }
    else {
      directionClause = '(e.source = t.node_id OR e.target = t.node_id)'
    }

    const nextNodeExpr
      = direction === 'in'
        ? 'e.source'
        : direction === 'out'
          ? 'e.target'
          : 'CASE WHEN e.source = t.node_id THEN e.target ELSE e.source END'

    const depTypeFilter = options.depTypeFilter ? `AND e.dep_type = '${options.depTypeFilter}'` : ''
    const entityFilter = options.entityTypeFilter
      ? `AND n2.entity_type = '${options.entityTypeFilter}'`
      : ''

    const sql = `
      WITH RECURSIVE traversal AS (
        SELECT ? AS node_id, 0 AS depth
        UNION ALL
        SELECT ${nextNodeExpr} AS node_id, t.depth + 1
        FROM edges e
        JOIN traversal t ON ${directionClause}
        JOIN nodes n2 ON n2.id = ${nextNodeExpr}
        WHERE t.depth < ?
          AND e.type IN (${edgeTypeIn})
          ${depTypeFilter}
          ${entityFilter}
      )
      SELECT DISTINCT node_id, depth FROM traversal WHERE depth > 0
    `

    const traversalRows = this.db.prepare(sql).all(startNode, maxDepth) as Array<{
      node_id: string
      depth: number
    }>

    const nodes: Node[] = []
    let maxDepthReached = 0
    for (const row of traversalRows) {
      const node = await this.getNode(row.node_id)
      if (node)
        nodes.push(node)
      if (row.depth > maxDepthReached)
        maxDepthReached = row.depth
    }

    // Collect edges between discovered nodes
    const nodeIds = new Set([startNode, ...traversalRows.map(r => r.node_id)])
    const placeholders = [...nodeIds].map(() => '?').join(',')
    const edgeRows = this.db
      .prepare(
        `SELECT source, target, type, dep_type FROM edges
         WHERE source IN (${placeholders})
           AND target IN (${placeholders})
           AND type IN (${edgeTypeIn})`,
      )
      .all(...nodeIds, ...nodeIds) as Array<{
      source: string
      target: string
      type: string
      dep_type: string | null
    }>

    const edges = edgeRows.map(r => ({
      source: r.source,
      target: r.target,
      type: r.type,
      depType: r.dep_type ?? undefined,
    }))

    return { nodes, edges, maxDepthReached }
  }

  // ==================== Search ====================

  async searchByFeature(query: string, scopes?: string[]): Promise<SearchHit[]> {
    const ftsQuery = this.toFtsQuery(query)
    if (!ftsQuery)
      return []

    let sql: string
    const params: BindValue[] = []

    if (scopes && scopes.length > 0) {
      // Scope-restricted search: find subtree first, then FTS within
      const scopePlaceholders = scopes.map(() => '?').join(', ')
      sql = `
        WITH RECURSIVE subtree AS (
          SELECT id FROM nodes WHERE id IN (${scopePlaceholders})
          UNION ALL
          SELECT e.target FROM edges e
          JOIN subtree s ON e.source = s.id
          WHERE e.type = 'functional'
        )
        SELECT n.*, rank
        FROM nodes_fts
        JOIN nodes n ON nodes_fts.rowid = n.rowid
        WHERE nodes_fts MATCH ?
          AND n.id IN (SELECT id FROM subtree)
        ORDER BY rank
        LIMIT 50
      `
      params.push(...scopes, ftsQuery)
    }
    else {
      sql = `
        SELECT n.*, rank
        FROM nodes_fts
        JOIN nodes n ON nodes_fts.rowid = n.rowid
        WHERE nodes_fts MATCH ?
        ORDER BY rank
        LIMIT 50
      `
      params.push(ftsQuery)
    }

    const rows = this.db.prepare(sql).all(...params) as Array<NodeRow & { rank: number }>
    return rows.map(r => ({
      node: this.rowToNode(r),
      score: -r.rank, // FTS5 rank is negative (lower = better)
    }))
  }

  /**
   * Convert a plain-text query into an FTS5 MATCH expression with prefix matching.
   *
   * Restricts to feature columns only (feature_desc, feature_keywords) to match
   * the original graphology behavior which searched description + keywords, not paths.
   *
   * Each word becomes a prefix token: "auth" → {feature_desc feature_keywords} : "auth" *
   */
  private toFtsQuery(query: string): string | null {
    // Extract alphanumeric words, discard punctuation
    const words = query.match(/\w+/g)
    if (!words || words.length === 0)
      return null
    // Restrict to feature columns, prefix match each word
    const cols = '{feature_desc feature_keywords}'
    return words.map(w => `${cols} : "${w}" *`).join(' OR ')
  }

  async searchByPath(pattern: string): Promise<Node[]> {
    // Convert glob/regex patterns to SQL LIKE:
    //   ".*" → "%"  (regex any)
    //   "*"  → "%"  (glob any)
    //   "."  → "_"  (single char, only when standalone regex dot)
    const likePattern = pattern.replace(/\.\*/g, '%').replace(/\*/g, '%')
    const rows = this.db
      .prepare('SELECT * FROM nodes WHERE path LIKE ?')
      .all(likePattern) as NodeRow[]
    return rows.map(r => this.rowToNode(r))
  }

  // ==================== Ordering ====================

  async getTopologicalOrder(): Promise<Node[]> {
    // Kahn's algorithm via SQL: nodes with no unresolved dependencies first
    const rows = this.db
      .prepare(
        `WITH RECURSIVE topo AS (
          -- Nodes with no outgoing dependency edges (leaves)
          SELECT id, 0 AS ord FROM nodes
          WHERE id NOT IN (SELECT source FROM edges WHERE type = 'dependency')
          UNION ALL
          -- Add nodes whose dependencies are all resolved
          SELECT e.source, t.ord + 1
          FROM edges e
          JOIN topo t ON e.target = t.id
          WHERE e.type = 'dependency'
        )
        SELECT DISTINCT n.*
        FROM topo t
        JOIN nodes n ON n.id = t.id
        ORDER BY t.ord DESC`,
      )
      .all() as NodeRow[]
    return rows.map(r => this.rowToNode(r))
  }

  // ==================== Statistics ====================

  async getStats(): Promise<GraphStats> {
    const counts = this.db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM nodes) as nodeCount,
          (SELECT COUNT(*) FROM edges) as edgeCount,
          (SELECT COUNT(*) FROM nodes WHERE type = 'high_level') as highLevelNodeCount,
          (SELECT COUNT(*) FROM nodes WHERE type = 'low_level') as lowLevelNodeCount,
          (SELECT COUNT(*) FROM edges WHERE type = 'functional') as functionalEdgeCount,
          (SELECT COUNT(*) FROM edges WHERE type = 'dependency') as dependencyEdgeCount`,
      )
      .get() as GraphStats
    return counts
  }

  // ==================== Serialization ====================

  async importJSON(data: SerializedRPG): Promise<void> {
    const insertNode = this.db.prepare(`
      INSERT OR REPLACE INTO nodes (id, type, feature_desc, feature_keywords, feature_sub,
        entity_type, path, qualified_name, language, line_start, line_end,
        directory_path, source_code, extra)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertEdge = this.db.prepare(`
      INSERT OR REPLACE INTO edges (source, target, type, level, sibling_order, dep_type, is_runtime, dep_line, weight)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const transaction = this.db.transaction(() => {
      for (const nodeData of data.nodes) {
        const node = nodeData as Node
        insertNode.run(
          node.id,
          node.type,
          node.feature.description,
          node.feature.keywords ? JSON.stringify(node.feature.keywords) : null,
          node.feature.subFeatures ? JSON.stringify(node.feature.subFeatures) : null,
          node.metadata?.entityType ?? null,
          node.metadata?.path ?? null,
          node.metadata?.qualifiedName ?? null,
          node.metadata?.language ?? null,
          node.metadata?.startLine ?? null,
          node.metadata?.endLine ?? null,
          node.type === 'high_level' ? ((node as HighLevelNode).directoryPath ?? null) : null,
          node.type === 'low_level' ? ((node as LowLevelNode).sourceCode ?? null) : null,
          node.metadata?.extra ? JSON.stringify(node.metadata.extra) : null,
        )
      }

      for (const edgeData of data.edges) {
        const edge = edgeData as Edge
        insertEdge.run(
          edge.source,
          edge.target,
          edge.type,
          edge.type === 'functional' ? ((edge as FunctionalEdge).level ?? null) : null,
          edge.type === 'functional' ? ((edge as FunctionalEdge).siblingOrder ?? null) : null,
          edge.type === 'dependency' ? ((edge as DependencyEdge).dependencyType ?? null) : null,
          edge.type === 'dependency' ? ((edge as DependencyEdge).isRuntime ? 1 : 0) : null,
          edge.type === 'dependency' ? ((edge as DependencyEdge).line ?? null) : null,
          edge.weight ?? null,
        )
      }
    })

    transaction()
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

  private rowToNode(row: NodeRow): Node {
    const feature = {
      description: row.feature_desc,
      keywords: row.feature_keywords ? JSON.parse(row.feature_keywords) : undefined,
      subFeatures: row.feature_sub ? JSON.parse(row.feature_sub) : undefined,
    }

    const metadata
      = row.entity_type || row.path
        ? {
            entityType: (row.entity_type as StructuralMetadata['entityType']) ?? undefined,
            path: row.path ?? undefined,
            qualifiedName: row.qualified_name ?? undefined,
            language: row.language ?? undefined,
            startLine: row.line_start ?? undefined,
            endLine: row.line_end ?? undefined,
            extra: row.extra ? JSON.parse(row.extra) : undefined,
          }
        : undefined

    if (row.type === 'high_level') {
      return {
        id: row.id,
        type: 'high_level' as const,
        feature,
        metadata,
        directoryPath: row.directory_path ?? undefined,
      } satisfies HighLevelNode
    }

    return {
      id: row.id,
      type: 'low_level' as const,
      feature,
      metadata: metadata ?? {},
      sourceCode: row.source_code ?? undefined,
    } satisfies LowLevelNode
  }

  private rowToEdge(row: EdgeRow): Edge {
    if (row.type === 'functional') {
      return {
        source: row.source,
        target: row.target,
        type: 'functional' as const,
        level: row.level ?? undefined,
        siblingOrder: row.sibling_order ?? undefined,
        weight: row.weight ?? undefined,
      }
    }

    return {
      source: row.source,
      target: row.target,
      type: 'dependency' as const,
      dependencyType: (row.dep_type ?? 'use') as
      | 'import'
      | 'call'
      | 'inherit'
      | 'implement'
      | 'use',
      isRuntime: row.is_runtime === 1 ? true : undefined,
      line: row.dep_line ?? undefined,
      weight: row.weight ?? undefined,
    }
  }
}

// ==================== Row Types ====================

interface NodeRow {
  id: string
  type: string
  feature_desc: string
  feature_keywords: string | null
  feature_sub: string | null
  entity_type: string | null
  path: string | null
  qualified_name: string | null
  language: string | null
  line_start: number | null
  line_end: number | null
  directory_path: string | null
  source_code: string | null
  extra: string | null
  created_at: number
  updated_at: number
}

interface EdgeRow {
  id: number
  source: string
  target: string
  type: string
  level: number | null
  sibling_order: number | null
  dep_type: string | null
  is_runtime: number | null
  dep_line: number | null
  weight: number | null
}
