import type { ContextStore } from './context-store'
import type { GraphStore } from './graph-store'
import type { TextSearchStore } from './text-search-store'

import type { ContextStoreConfig } from './types'
import type { VectorStore } from './vector-store'

/**
 * DefaultContextStore — Composes SQLiteGraphStore + SQLiteTextSearchStore + LocalVectorStore.
 *
 * Lazily imports implementation modules to avoid loading engine dependencies until needed.
 */
export class DefaultContextStore implements ContextStore {
  private _graph!: GraphStore
  private _text!: TextSearchStore
  private _vector!: VectorStore

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
    let graphStore: GraphStore
    let textStore: TextSearchStore

    try {
      const { SQLiteGraphStore } = await import('./sqlite/graph-store')
      const { SQLiteTextSearchStore } = await import('./sqlite/text-search-store')
      const sqliteGraph = new SQLiteGraphStore()
      await sqliteGraph.open(config.path)
      graphStore = sqliteGraph
      textStore = new SQLiteTextSearchStore(sqliteGraph.getDatabase())
      await textStore.open(config.path)
    }
    catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'MODULE_NOT_FOUND' && code !== 'ERR_MODULE_NOT_FOUND') {
        throw err
      }
      const { LocalGraphStore } = await import('./local/graph-store')
      const { LocalTextSearchStore } = await import('./local/text-search-store')
      const localGraph = new LocalGraphStore()
      await localGraph.open({ path: config.path === 'memory' ? 'memory' : config.path })
      graphStore = localGraph
      const localText = new LocalTextSearchStore()
      await localText.open({})
      textStore = localText
    }

    const { LocalVectorStore } = await import('./local/vector-store')
    const vectorStore = new LocalVectorStore()
    const isMemory = config.path === 'memory' && !config.vectorPath
    const vectorPath = config.vectorPath ?? (isMemory ? 'memory' : `${config.path}-vectors`)
    await vectorStore.open({ path: vectorPath })

    this._graph = graphStore
    this._text = textStore
    this._vector = vectorStore
  }

  async close(): Promise<void> {
    const errors: unknown[] = []
    for (const store of [this._vector, this._text, this._graph]) {
      try {
        await store.close()
      }
      catch (err) {
        errors.push(err)
      }
    }
    if (errors.length > 0) {
      throw new Error(`DefaultContextStore.close() failed: ${errors.map(e => e instanceof Error ? e.message : String(e)).join('; ')}`)
    }
  }
}
