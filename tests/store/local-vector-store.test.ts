import { LocalVectorStore } from '@pleaseai/rpg-store/local'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('LocalVectorStore', () => {
  let store: LocalVectorStore

  beforeEach(async () => {
    store = new LocalVectorStore()
    await store.open({ path: 'memory' })
  })

  afterEach(async () => {
    await store.close()
  })

  it('returns empty results when no data', async () => {
    const results = await store.search([1, 0, 0])
    expect(results).toEqual([])
  })

  it('count returns 0 initially', async () => {
    expect(await store.count()).toBe(0)
  })

  it('upsert adds an entry and count reflects it', async () => {
    await store.upsert('a', [1, 0, 0])
    expect(await store.count()).toBe(1)
  })

  it('search returns results sorted by descending similarity', async () => {
    await store.upsert('a', [1, 0, 0])
    await store.upsert('b', [0, 1, 0])
    await store.upsert('c', [0.9, 0.1, 0])

    const results = await store.search([1, 0, 0], { topK: 3 })
    expect(results[0].id).toBe('a')
    expect(results[1].id).toBe('c')
    expect(results[2].id).toBe('b')
    // scores are in descending order
    expect(results[0].score).toBeGreaterThan(results[1].score)
    expect(results[1].score).toBeGreaterThan(results[2].score)
  })

  it('search respects topK', async () => {
    await store.upsert('a', [1, 0, 0])
    await store.upsert('b', [0, 1, 0])
    await store.upsert('c', [0, 0, 1])

    const results = await store.search([1, 0, 0], { topK: 2 })
    expect(results).toHaveLength(2)
  })

  it('search preserves metadata in results', async () => {
    await store.upsert('a', [1, 0, 0], { kind: 'function', file: 'foo.ts' })
    const results = await store.search([1, 0, 0], { topK: 1 })
    expect(results[0].metadata).toEqual({ kind: 'function', file: 'foo.ts' })
  })

  it('remove deletes an entry', async () => {
    await store.upsert('a', [1, 0, 0])
    await store.upsert('b', [0, 1, 0])
    await store.remove('a')
    expect(await store.count()).toBe(1)
    const results = await store.search([1, 0, 0])
    expect(results.length).toBeGreaterThan(0)
    expect(results.every(r => r.id !== 'a')).toBe(true)
  })

  it('upsert replaces existing entry', async () => {
    await store.upsert('a', [1, 0, 0], { v: 1 })
    await store.upsert('a', [0, 1, 0], { v: 2 })
    expect(await store.count()).toBe(1)
    const results = await store.search([0, 1, 0], { topK: 1 })
    expect(results[0].id).toBe('a')
    expect(results[0].metadata).toEqual({ v: 2 })
  })

  it('upsertBatch adds multiple entries with a single flush', async () => {
    await store.upsertBatch([
      { id: 'x', embedding: [1, 0, 0] },
      { id: 'y', embedding: [0, 1, 0] },
      { id: 'z', embedding: [0, 0, 1] },
    ])
    expect(await store.count()).toBe(3)
  })

  it('clear removes all entries', async () => {
    await store.upsert('a', [1, 0, 0])
    await store.upsert('b', [0, 1, 0])
    await store.clear()
    expect(await store.count()).toBe(0)
    const results = await store.search([1, 0, 0])
    expect(results).toEqual([])
  })

  it('clear persists — data is gone after reopen', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const dir = mkdtempSync(join(tmpdir(), 'rpg-lvs-clear-'))
    try {
      const s1 = new LocalVectorStore()
      await s1.open({ path: dir })
      await s1.upsert('x', [1, 0, 0])
      await s1.clear()
      await s1.close()

      const s2 = new LocalVectorStore()
      await s2.open({ path: dir })
      expect(await s2.count()).toBe(0)
      await s2.close()
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('persists data across close and reopen', async () => {
    // Use a real temp dir (open with 'memory' allocates one internally, but
    // we need the path after close — so use a deterministic temp path instead)
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { rmSync } = await import('node:fs')

    const dir = mkdtempSync(join(tmpdir(), 'rpg-lvs-test-'))
    try {
      const s1 = new LocalVectorStore()
      await s1.open({ path: dir })
      await s1.upsert('p', [1, 0, 0], { note: 'persisted' })
      await s1.close()

      const s2 = new LocalVectorStore()
      await s2.open({ path: dir })
      expect(await s2.count()).toBe(1)
      const results = await s2.search([1, 0, 0], { topK: 1 })
      expect(results[0].id).toBe('p')
      expect(results[0].metadata).toEqual({ note: 'persisted' })
      await s2.close()
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
