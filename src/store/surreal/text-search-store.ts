import type { TextSearchStore } from '../text-search-store'
import type { TextSearchOpts, TextSearchResult } from '../types'
import { createNodeEngines } from '@surrealdb/node'
import { RecordId, Surreal } from 'surrealdb'

const SCHEMA = `
DEFINE TABLE IF NOT EXISTS text_doc SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS feature_desc ON text_doc TYPE option<string>;
DEFINE FIELD IF NOT EXISTS feature_keywords ON text_doc TYPE option<string>;
DEFINE FIELD IF NOT EXISTS path ON text_doc TYPE option<string>;
DEFINE FIELD IF NOT EXISTS qualified_name ON text_doc TYPE option<string>;

DEFINE ANALYZER IF NOT EXISTS text_analyzer TOKENIZERS blank, class FILTERS lowercase, ascii, snowball(english);
DEFINE INDEX IF NOT EXISTS ft_feature_desc ON text_doc FIELDS feature_desc SEARCH ANALYZER text_analyzer BM25;
DEFINE INDEX IF NOT EXISTS ft_feature_keywords ON text_doc FIELDS feature_keywords SEARCH ANALYZER text_analyzer BM25;
DEFINE INDEX IF NOT EXISTS ft_path ON text_doc FIELDS path SEARCH ANALYZER text_analyzer BM25;
DEFINE INDEX IF NOT EXISTS ft_qualified_name ON text_doc FIELDS qualified_name SEARCH ANALYZER text_analyzer BM25;
`

interface DocRecord {
  id: RecordId | string
  feature_desc?: string | null
  feature_keywords?: string | null
  path?: string | null
  qualified_name?: string | null
  score?: number
}

/**
 * SurrealTextSearchStore — TextSearchStore implementation using SurrealDB BM25 search.
 *
 * Can share a Surreal connection with SurrealGraphStore via constructor injection.
 */
export class SurrealTextSearchStore implements TextSearchStore {
  private db!: Surreal
  private ownsDb = false

  /** Create with an optional shared Surreal connection */
  constructor(sharedDb?: Surreal) {
    if (sharedDb) {
      this.db = sharedDb
      this.ownsDb = false
    }
  }

  async open(config: unknown): Promise<void> {
    if (!this.db) {
      const path = config as string
      this.db = new Surreal({ engines: createNodeEngines() })
      const url = path === 'memory' ? 'mem://' : `surrealkv://${path}`
      await this.db.connect(url)
      await this.db.use({ namespace: 'rpg', database: 'main' })
      this.ownsDb = true
    }
    await this.db.query(SCHEMA).collect()
  }

  async close(): Promise<void> {
    if (this.ownsDb) {
      await this.db.close()
    }
  }

  async index(
    id: string,
    fields: Record<string, string>,
    _metadata?: Record<string, unknown>,
  ): Promise<void> {
    const content: Record<string, unknown> = {}
    if (fields.feature_desc)
      content.feature_desc = fields.feature_desc
    if (fields.feature_keywords)
      content.feature_keywords = fields.feature_keywords
    if (fields.path)
      content.path = fields.path
    if (fields.qualified_name)
      content.qualified_name = fields.qualified_name

    // Delete then re-create to simulate upsert (SurrealDB SCHEMAFULL)
    // Use query-based DELETE to avoid "ONLY" error when record doesn't exist
    await this.db.query('DELETE $id', { id: new RecordId('text_doc', id) }).collect()
    await this.db.create(new RecordId('text_doc', id)).content(content)
  }

  async remove(id: string): Promise<void> {
    await this.db.query('DELETE $id', { id: new RecordId('text_doc', id) }).collect()
  }

  async search(query: string, opts?: TextSearchOpts): Promise<TextSearchResult[]> {
    const limit = opts?.topK ?? 50
    const searchFields = opts?.fields ?? ['feature_desc', 'feature_keywords']

    // Search on the first specified field using BM25 (SurrealDB only supports one @@ per query)
    const field = searchFields[0]
    const [rows] = await this.db
      .query<[Array<DocRecord & { score: number }>]>(
        `SELECT *, search::score(1) AS score FROM text_doc
         WHERE ${field} @1@ $query
         ORDER BY score DESC LIMIT $limit`,
        { query, limit },
      )
      .collect()

    return rows.map(r => ({
      id: this.extractId(r.id),
      score: r.score,
      fields: {
        ...(r.feature_desc ? { feature_desc: r.feature_desc } : {}),
        ...(r.feature_keywords ? { feature_keywords: r.feature_keywords } : {}),
        ...(r.path ? { path: r.path } : {}),
        ...(r.qualified_name ? { qualified_name: r.qualified_name } : {}),
      },
    }))
  }

  async indexBatch(docs: Array<{ id: string, fields: Record<string, string> }>): Promise<void> {
    for (const doc of docs) {
      await this.index(doc.id, doc.fields)
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
