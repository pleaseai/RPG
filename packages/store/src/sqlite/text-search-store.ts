import type { TextSearchStore } from '../text-search-store'
import type { TextSearchOpts, TextSearchResult } from '../types'
import Database from 'better-sqlite3'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS text_docs (
    id     TEXT PRIMARY KEY,
    fields TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS text_fts USING fts5(
    feature_desc,
    feature_keywords,
    path,
    qualified_name,
    content='text_docs',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS text_docs_ai AFTER INSERT ON text_docs BEGIN
    INSERT INTO text_fts(rowid, feature_desc, feature_keywords, path, qualified_name)
    VALUES (
        new.rowid,
        json_extract(new.fields, '$.feature_desc'),
        json_extract(new.fields, '$.feature_keywords'),
        json_extract(new.fields, '$.path'),
        json_extract(new.fields, '$.qualified_name')
    );
END;

CREATE TRIGGER IF NOT EXISTS text_docs_ad AFTER DELETE ON text_docs BEGIN
    INSERT INTO text_fts(text_fts, rowid, feature_desc, feature_keywords, path, qualified_name)
    VALUES(
        'delete',
        old.rowid,
        json_extract(old.fields, '$.feature_desc'),
        json_extract(old.fields, '$.feature_keywords'),
        json_extract(old.fields, '$.path'),
        json_extract(old.fields, '$.qualified_name')
    );
END;

CREATE TRIGGER IF NOT EXISTS text_docs_au AFTER UPDATE ON text_docs BEGIN
    INSERT INTO text_fts(text_fts, rowid, feature_desc, feature_keywords, path, qualified_name)
    VALUES(
        'delete',
        old.rowid,
        json_extract(old.fields, '$.feature_desc'),
        json_extract(old.fields, '$.feature_keywords'),
        json_extract(old.fields, '$.path'),
        json_extract(old.fields, '$.qualified_name')
    );
    INSERT INTO text_fts(rowid, feature_desc, feature_keywords, path, qualified_name)
    VALUES (
        new.rowid,
        json_extract(new.fields, '$.feature_desc'),
        json_extract(new.fields, '$.feature_keywords'),
        json_extract(new.fields, '$.path'),
        json_extract(new.fields, '$.qualified_name')
    );
END;
`

/**
 * SQLiteTextSearchStore — TextSearchStore implementation using FTS5.
 *
 * Can share a Database connection with SQLiteGraphStore via constructor injection,
 * or open its own connection.
 */
export class SQLiteTextSearchStore implements TextSearchStore {
  private db!: InstanceType<typeof Database>
  private ownsDb = false

  /** Create with an optional shared database connection */
  constructor(sharedDb?: InstanceType<typeof Database>) {
    if (sharedDb) {
      this.db = sharedDb
      this.ownsDb = false
    }
  }

  async open(config: unknown): Promise<void> {
    if (!this.db) {
      const path = config as string
      this.db = new Database(path === 'memory' ? ':memory:' : path)
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('foreign_keys = ON')
      this.ownsDb = true
    }
    this.db.exec(SCHEMA)
  }

  async close(): Promise<void> {
    if (this.ownsDb) {
      this.db.close()
    }
  }

  async index(
    id: string,
    fields: Record<string, string>,
    _metadata?: Record<string, unknown>,
  ): Promise<void> {
    this.db
      .prepare('INSERT OR REPLACE INTO text_docs (id, fields) VALUES (?, ?)')
      .run(id, JSON.stringify(fields))
  }

  async remove(id: string): Promise<void> {
    this.db.prepare('DELETE FROM text_docs WHERE id = ?').run(id)
  }

  async search(query: string, opts?: TextSearchOpts): Promise<TextSearchResult[]> {
    const ftsQuery = this.toFtsQuery(query, opts?.fields)
    if (!ftsQuery)
      return []

    const limit = opts?.topK ?? 50

    const sql = `
      SELECT td.id, td.fields, rank
      FROM text_fts
      JOIN text_docs td ON text_fts.rowid = td.rowid
      WHERE text_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `

    const rows = this.db.prepare(sql).all(ftsQuery, limit) as Array<{
      id: string
      fields: string
      rank: number
    }>

    return rows.map(r => ({
      id: r.id,
      score: -r.rank, // FTS5 rank is negative (lower = better)
      fields: JSON.parse(r.fields),
    }))
  }

  async indexBatch(docs: Array<{ id: string, fields: Record<string, string> }>): Promise<void> {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO text_docs (id, fields) VALUES (?, ?)')
    const transaction = this.db.transaction(() => {
      for (const doc of docs) {
        stmt.run(doc.id, JSON.stringify(doc.fields))
      }
    })
    transaction()
  }

  /**
   * Convert a plain-text query into an FTS5 MATCH expression with prefix matching.
   * Optionally restrict to specific columns.
   */
  private toFtsQuery(query: string, fields?: string[]): string | null {
    const words = query.match(/\w+/g)
    if (!words || words.length === 0)
      return null

    // Default: search feature columns only (matches original behavior)
    const cols = fields ? `{${fields.join(' ')}}` : '{feature_desc feature_keywords}'

    return words.map(w => `${cols} : "${w}" *`).join(' OR ')
  }
}
