import type { VectorSearchOpts, VectorSearchResult } from '../types'
import type { VectorStore } from '../vector-store'
import * as lancedb from '@lancedb/lancedb'

interface VectorDocument {
  id: string
  vector: number[]
  metadata?: string // JSON serialized
  [key: string]: unknown
}

/**
 * LanceDBVectorStore — VectorStore implementation using LanceDB.
 *
 * Disk-based, no external server required. Supports vector similarity search.
 */
export class LanceDBVectorStore implements VectorStore {
  private db: lancedb.Connection | null = null
  private table: lancedb.Table | null = null
  private tableName = 'vectors'

  async open(config: unknown): Promise<void> {
    const cfg = config as { path: string, tableName?: string, dimension?: number }
    if (cfg.tableName)
      this.tableName = cfg.tableName
    this.db = await lancedb.connect(cfg.path)

    const tableNames = await this.db.tableNames()
    if (tableNames.includes(this.tableName)) {
      this.table = await this.db.openTable(this.tableName)
    }
  }

  async close(): Promise<void> {
    this.db = null
    this.table = null
  }

  async upsert(id: string, embedding: number[], metadata?: Record<string, unknown>): Promise<void> {
    await this.ensureDb()

    const doc: VectorDocument = {
      id,
      vector: embedding,
      metadata: JSON.stringify(metadata ?? {}),
    }

    if (this.table) {
      // Try delete first for upsert semantics
      try {
        await this.table.delete(`id = '${id}'`)
      }
      catch {
        // Ignore if not found
      }
      await this.table.add([doc])
    }
    else {
      this.table = await this.db!.createTable(this.tableName, [doc])
    }
  }

  async remove(id: string): Promise<void> {
    if (!this.table)
      return
    await this.table.delete(`id = '${id}'`)
  }

  async search(query: number[], opts?: VectorSearchOpts): Promise<VectorSearchResult[]> {
    if (!this.table)
      return []

    const topK = opts?.topK ?? 10
    const results = await this.table.search(query).limit(topK).toArray()

    return results.map((row) => {
      const parsedMetadata = row.metadata ? JSON.parse(row.metadata as string) : {}
      const hasMetadata = Object.keys(parsedMetadata).length > 0
      return {
        id: row.id as string,
        score: row._distance as number,
        metadata: hasMetadata ? parsedMetadata : undefined,
      }
    })
  }

  async upsertBatch(
    docs: Array<{ id: string, embedding: number[], metadata?: Record<string, unknown> }>,
  ): Promise<void> {
    await this.ensureDb()

    const data: VectorDocument[] = docs.map(doc => ({
      id: doc.id,
      vector: doc.embedding,
      metadata: JSON.stringify(doc.metadata ?? {}),
    }))

    if (this.table) {
      await this.table.add(data)
    }
    else {
      this.table = await this.db!.createTable(this.tableName, data)
    }
  }

  async count(): Promise<number> {
    if (!this.table)
      return 0
    return await this.table.countRows()
  }

  private async ensureDb(): Promise<void> {
    if (!this.db) {
      throw new Error('LanceDBVectorStore not opened. Call open() first.')
    }
  }
}
