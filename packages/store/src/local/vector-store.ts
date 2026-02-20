import type { VectorSearchOpts, VectorSearchResult } from '../types'
import type { VectorStore } from '../vector-store'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface LocalVectorDocument {
  embedding: number[]
  metadata?: Record<string, unknown>
}

/**
 * LocalVectorStore — Zero-dependency, JSON file-based VectorStore.
 *
 * Inspired by Genkit's dev-local-vectorstore. Uses brute-force cosine
 * similarity search. Suitable as a LanceDB fallback when native binaries
 * are unavailable.
 *
 * Storage: single JSON file at `{path}/vectors.json`.
 * Memory mode: pass path `'memory'` to use a temp directory.
 */
export class LocalVectorStore implements VectorStore {
  private index: Map<string, LocalVectorDocument> = new Map()
  private filePath: string | null = null
  private _tempDir: string | undefined = undefined

  async open(config: unknown): Promise<void> {
    if (
      typeof config !== 'object'
      || config === null
      || typeof (config as Record<string, unknown>).path !== 'string'
    ) {
      throw new TypeError(
        `LocalVectorStore.open() requires config.path: string, got: ${JSON.stringify(config)}`,
      )
    }
    const cfg = config as { path: string }
    let dir = cfg.path

    if (dir === 'memory') {
      dir = mkdtempSync(join(tmpdir(), 'rpg-local-vectors-'))
      this._tempDir = dir
    }
    else {
      mkdirSync(dir, { recursive: true })
    }

    this.filePath = join(dir, 'vectors.json')

    try {
      const raw = readFileSync(this.filePath, 'utf8')
      const stored = JSON.parse(raw) as Record<string, LocalVectorDocument>
      this.index = new Map(Object.entries(stored))
    }
    catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist yet — start with empty index
        this.index = new Map()
      }
      else {
        throw new Error(
          `Failed to load vector index from ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  async close(): Promise<void> {
    try {
      this.flush()
    }
    finally {
      this.index = new Map()
      this.filePath = null
      if (this._tempDir) {
        rmSync(this._tempDir, { recursive: true, force: true })
        this._tempDir = undefined
      }
    }
  }

  async upsert(id: string, embedding: number[], metadata?: Record<string, unknown>): Promise<void> {
    this.index.set(id, { embedding, metadata })
    this.flush()
  }

  async remove(id: string): Promise<void> {
    this.index.delete(id)
    this.flush()
  }

  async search(query: number[], opts?: VectorSearchOpts): Promise<VectorSearchResult[]> {
    const topK = opts?.topK ?? 10
    const results: VectorSearchResult[] = []

    for (const [id, doc] of this.index) {
      const score = cosineSimilarity(query, doc.embedding)
      results.push({ id, score, metadata: doc.metadata })
    }

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }

  async upsertBatch(
    docs: Array<{ id: string, embedding: number[], metadata?: Record<string, unknown> }>,
  ): Promise<void> {
    for (const doc of docs) {
      this.index.set(doc.id, { embedding: doc.embedding, metadata: doc.metadata })
    }
    this.flush()
  }

  async count(): Promise<number> {
    return this.index.size
  }

  async clear(): Promise<void> {
    this.index = new Map()
    this.flush()
  }

  private flush(): void {
    if (!this.filePath)
      return
    const obj: Record<string, LocalVectorDocument> = {}
    for (const [id, doc] of this.index) {
      obj[id] = doc
    }
    writeFileSync(this.filePath, JSON.stringify(obj), 'utf8')
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`)
  }
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!
    const bi = b[i]!
    dot += ai * bi
    normA += ai * ai
    normB += bi * bi
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}
