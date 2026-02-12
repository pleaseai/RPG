import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VectorStore } from '@pleaseai/rpg-utils/vector'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('vectorStore Hybrid Search', () => {
  let store: VectorStore
  let testDbPath: string
  const dimension = 64

  /**
   * Generate a deterministic vector from a seed string
   */
  function makeVector(seed: string): number[] {
    const vector: number[] = []
    let hash = 0
    for (let i = 0; i < seed.length; i++) {
      hash = (hash * 31 + (seed.codePointAt(i) ?? 0)) % 2147483647
    }
    for (let i = 0; i < dimension; i++) {
      hash = (hash * 1103515245 + 12345) % 2147483648
      vector.push((hash / 2147483647) * 2 - 1)
    }
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0))
    return vector.map(val => val / magnitude)
  }

  beforeEach(async () => {
    testDbPath = join(
      tmpdir(),
      `rpg-vector-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    store = new VectorStore({
      dbPath: testDbPath,
      tableName: 'test_vectors',
      dimension,
    })

    // Add test documents
    await store.add([
      {
        id: 'auth-1',
        text: 'User login and authentication handler',
        vector: makeVector('auth-login'),
        metadata: { module: 'auth' },
      },
      {
        id: 'auth-2',
        text: 'User logout and session termination',
        vector: makeVector('auth-logout'),
        metadata: { module: 'auth' },
      },
      {
        id: 'db-1',
        text: 'Database connection pool manager',
        vector: makeVector('db-conn'),
        metadata: { module: 'db' },
      },
      {
        id: 'db-2',
        text: 'SQL query executor and result mapper',
        vector: makeVector('db-query'),
        metadata: { module: 'db' },
      },
      {
        id: 'api-1',
        text: 'REST API endpoint handler',
        vector: makeVector('api-rest'),
        metadata: { module: 'api' },
      },
    ])
  })

  afterEach(async () => {
    await store.close()
    try {
      await rm(testDbPath, { recursive: true, force: true })
    }
    catch {
      // Ignore cleanup errors
    }
  })

  describe('createFtsIndex', () => {
    it('should create FTS index idempotently', async () => {
      // Index was already created in add() above, calling again should not throw
      await store.createFtsIndex()
      await store.createFtsIndex()

      const count = await store.count()
      expect(count).toBe(5)
    })
  })

  describe('searchFts', () => {
    it('should return results for text query', async () => {
      const results = await store.searchFts('authentication', 3)

      expect(results.length).toBeGreaterThan(0)
      expect(results.length).toBeLessThanOrEqual(3)
      for (const result of results) {
        expect(result.id).toBeDefined()
        expect(result.text).toBeDefined()
      }
    })

    it('should return results matching database terms', async () => {
      const results = await store.searchFts('database connection', 3)

      expect(results.length).toBeGreaterThan(0)
      // Should find the database-related document
      const ids = results.map(r => r.id)
      expect(ids).toContain('db-1')
    })

    it('should respect topK', async () => {
      const results = await store.searchFts('handler', 2)
      expect(results.length).toBeLessThanOrEqual(2)
    })

    it('should return empty for no matches', async () => {
      const results = await store.searchFts('zzzznonexistentterm', 5)
      expect(results.length).toBe(0)
    })
  })

  describe('searchHybrid', () => {
    it('should combine vector and FTS results', async () => {
      const results = await store.searchHybrid({
        textQuery: 'authentication login',
        queryVector: makeVector('auth-login'),
        mode: 'hybrid',
        topK: 3,
        vectorWeight: 0.7,
      })

      expect(results.length).toBeGreaterThan(0)
      expect(results.length).toBeLessThanOrEqual(3)
    })

    it('should fall back to vector-only when mode is vector', async () => {
      const results = await store.searchHybrid({
        textQuery: 'authentication',
        queryVector: makeVector('auth-login'),
        mode: 'vector',
        topK: 3,
      })

      expect(results.length).toBeGreaterThan(0)
      // Should have distance-based scores (lower = better)
      for (const result of results) {
        expect(typeof result.score).toBe('number')
      }
    })

    it('should fall back to FTS-only when mode is fts', async () => {
      const results = await store.searchHybrid({
        textQuery: 'database',
        queryVector: makeVector('irrelevant'),
        mode: 'fts',
        topK: 3,
      })

      expect(results.length).toBeGreaterThan(0)
    })
  })

  describe('rrfRerank', () => {
    it('should merge results from both sources', () => {
      const vectorResults = [
        { id: 'a', score: 0.1, text: 'text-a' },
        { id: 'b', score: 0.2, text: 'text-b' },
        { id: 'c', score: 0.3, text: 'text-c' },
      ]
      const ftsResults = [
        { id: 'b', score: 5.0, text: 'text-b' },
        { id: 'd', score: 4.0, text: 'text-d' },
        { id: 'a', score: 3.0, text: 'text-a' },
      ]

      const merged = store.rrfRerank(vectorResults, ftsResults, 0.5, 10)

      // 'b' and 'a' appear in both lists, should have higher RRF scores
      const ids = merged.map(r => r.id)
      expect(ids).toContain('a')
      expect(ids).toContain('b')
      expect(ids).toContain('c')
      expect(ids).toContain('d')

      // Items in both lists should be ranked higher
      const bIndex = ids.indexOf('b')
      const dIndex = ids.indexOf('d')
      expect(bIndex).toBeLessThan(dIndex) // 'b' is in both, 'd' only in FTS
    })

    it('should respect topK', () => {
      const vectorResults = [
        { id: 'a', score: 0.1, text: 'text-a' },
        { id: 'b', score: 0.2, text: 'text-b' },
      ]
      const ftsResults = [
        { id: 'c', score: 5.0, text: 'text-c' },
        { id: 'd', score: 4.0, text: 'text-d' },
      ]

      const merged = store.rrfRerank(vectorResults, ftsResults, 0.5, 2)
      expect(merged.length).toBe(2)
    })

    it('should weight vector results higher when vectorWeight > 0.5', () => {
      const vectorResults = [{ id: 'vec-top', score: 0.1, text: 'vector top' }]
      const ftsResults = [{ id: 'fts-top', score: 5.0, text: 'fts top' }]

      const merged = store.rrfRerank(vectorResults, ftsResults, 0.9, 10)

      // With 0.9 weight on vector, vec-top should rank higher
      expect(merged[0]?.id).toBe('vec-top')
    })

    it('should handle empty result sets', () => {
      const merged = store.rrfRerank([], [], 0.5, 10)
      expect(merged).toEqual([])
    })
  })
})
