import type { ContextStore } from './context-store'
import type { GraphStore } from './graph-store'
import type { TextSearchStore } from './text-search-store'

import type { ContextStoreConfig } from './types'
import type { VectorStore } from './vector-store'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * DefaultContextStore — Composes SQLiteGraphStore + SQLiteTextSearchStore + LanceDBVectorStore.
 *
 * Lazily imports implementation modules to avoid loading engine dependencies until needed.
 */
export class DefaultContextStore implements ContextStore {
  private _graph!: GraphStore
  private _text!: TextSearchStore
  private _vector!: VectorStore
  private _tempVectorPath?: string

  get graph(): GraphStore {
    return this._graph
  }

  get text(): TextSearchStore {
    return this._text
  }

  get vector(): VectorStore {
    return this._vector
  }

  async open(config: ContextStoreConfig): Promise<void> {
    // Lazy-import to avoid transitive deps at module level
    const { SQLiteGraphStore } = await import('./sqlite/graph-store')
    const { SQLiteTextSearchStore } = await import('./sqlite/text-search-store')
    const { LanceDBVectorStore } = await import('./lancedb/vector-store')

    // Create graph store
    const graphStore = new SQLiteGraphStore()
    await graphStore.open(config.path)

    // Create text search store sharing the same SQLite database
    const textStore = new SQLiteTextSearchStore(graphStore.getDatabase())
    await textStore.open(config.path)

    // Create vector store
    const vectorStore = new LanceDBVectorStore()
    const isMemory = config.path === 'memory' && !config.vectorPath
    const vectorPath
      = config.vectorPath
        ?? (isMemory
          ? mkdtempSync(join(tmpdir(), 'rpg-vectors-'))
          : `${config.path}-vectors`)
    if (isMemory)
      this._tempVectorPath = vectorPath
    await vectorStore.open({ path: vectorPath })

    this._graph = graphStore
    this._text = textStore
    this._vector = vectorStore
  }

  async close(): Promise<void> {
    try {
      await this._vector.close()
      await this._text.close()
      await this._graph.close()
    }
    finally {
      if (this._tempVectorPath) {
        rmSync(this._tempVectorPath, { recursive: true, force: true })
        this._tempVectorPath = undefined
      }
    }
  }
}
