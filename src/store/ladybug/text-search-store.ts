import type { TextSearchStore } from '../text-search-store'
import type { TextSearchOpts, TextSearchResult } from '../types'
import lbug from 'lbug'

// Global refs prevent GC from collecting native objects during worker exit
const _liveRefs: unknown[] = []

/**
 * LadybugTextSearchStore — TextSearchStore implementation using LadybugDB FTS extension.
 *
 * Uses BM25 full-text search via the `fts` extension.
 * The FTS index is a static snapshot — rebuilt lazily before each search when dirty.
 */
export class LadybugTextSearchStore implements TextSearchStore {
  private db!: InstanceType<typeof lbug.Database>
  private conn!: InstanceType<typeof lbug.Connection>
  private ftsIndexDirty = true
  private hasDocuments = false

  async open(config: unknown): Promise<void> {
    const path = config as string
    this.db = new lbug.Database(path === 'memory' ? ':memory:' : path)
    this.conn = new lbug.Connection(this.db)
    // Pin native objects to prevent GC segfault during process exit
    _liveRefs.push(this.db, this.conn)

    await this.conn.query('CREATE NODE TABLE IF NOT EXISTS TextDoc(id STRING PRIMARY KEY, fields STRING)')
    await this.conn.query('INSTALL fts')
    await this.conn.query('LOAD EXTENSION fts')
  }

  async close(): Promise<void> {
    await this.conn.close()
    await this.db.close()
  }

  async index(
    id: string,
    fields: Record<string, string>,
    _metadata?: Record<string, unknown>,
  ): Promise<void> {
    // Delete existing doc if present (upsert)
    await this.removeInternal(id)
    const stmt = await this.conn.prepare('CREATE (n:TextDoc {id: $id, fields: $fields})')
    await this.conn.execute(stmt, { id, fields: JSON.stringify(fields) })
    this.ftsIndexDirty = true
    this.hasDocuments = true
  }

  async remove(id: string): Promise<void> {
    await this.removeInternal(id)
    this.ftsIndexDirty = true
  }

  async search(query: string, opts?: TextSearchOpts): Promise<TextSearchResult[]> {
    const limit = opts?.topK ?? 50
    const searchFields = opts?.fields

    // If no documents, return empty
    if (!this.hasDocuments) {
      const countResult = await this.conn.query('MATCH (n:TextDoc) RETURN count(n) AS cnt')
      const countRows = await countResult.getAll()
      if (countRows.length === 0 || countRows[0].cnt === 0)
        return []
      this.hasDocuments = true
    }

    // Rebuild FTS index if dirty
    if (this.ftsIndexDirty) {
      await this.rebuildFtsIndex()
    }

    const result = await this.conn.query(
      `CALL QUERY_FTS_INDEX('TextDoc', 'text_fts', '${this.escapeQuery(query)}', conjunctive := false, TOP := ${limit})
       RETURN node.id, node.fields, score`,
    )
    const rows = await result.getAll()

    let results: TextSearchResult[] = rows.map((r) => {
      const fields = JSON.parse(r['node.fields'] as string) as Record<string, string>
      return {
        id: r['node.id'] as string,
        score: r.score as number,
        fields,
      }
    })

    // Field-restricted search: filter results to only those matching in specified fields
    if (searchFields && searchFields.length > 0) {
      const queryLower = query.toLowerCase()
      const queryTerms = queryLower.split(/\s+/)
      results = results.filter((r) => {
        if (!r.fields)
          return false
        return searchFields.some((field) => {
          const fieldValue = r.fields?.[field]
          if (!fieldValue)
            return false
          const valueLower = fieldValue.toLowerCase()
          return queryTerms.some(term => valueLower.includes(term))
        })
      })
    }

    return results
  }

  async indexBatch(docs: Array<{ id: string, fields: Record<string, string> }>): Promise<void> {
    for (const doc of docs) {
      await this.removeInternal(doc.id)
      const stmt = await this.conn.prepare('CREATE (n:TextDoc {id: $id, fields: $fields})')
      await this.conn.execute(stmt, { id: doc.id, fields: JSON.stringify(doc.fields) })
    }
    this.ftsIndexDirty = true
    this.hasDocuments = true
  }

  private async removeInternal(id: string): Promise<void> {
    const stmt = await this.conn.prepare('MATCH (n:TextDoc) WHERE n.id = $id DELETE n')
    await this.conn.execute(stmt, { id })
  }

  private async rebuildFtsIndex(): Promise<void> {
    // Drop existing index (ignore error if it doesn't exist)
    try {
      await this.conn.query(`CALL DROP_FTS_INDEX('TextDoc', 'text_fts')`)
    }
    catch {
      // Index may not exist yet
    }
    await this.conn.query(`CALL CREATE_FTS_INDEX('TextDoc', 'text_fts', ['fields'], stemmer := 'porter')`)
    this.ftsIndexDirty = false
  }

  private escapeQuery(query: string): string {
    return query.replace(/'/g, "\\'")
  }
}
