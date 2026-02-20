import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockEmbedding } from '@pleaseai/rpg-encoder/embedding'
import { SemanticSearch } from '@pleaseai/rpg-encoder/semantic-search'
import { LocalVectorStore } from '@pleaseai/rpg-store/local'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('semanticSearch', () => {
  let search: SemanticSearch
  let testDbPath: string

  beforeEach(async () => {
    testDbPath = join(tmpdir(), `rpg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    const embedding = new MockEmbedding(64) // Small dimension for fast tests
    const vectorStore = new LocalVectorStore()
    await vectorStore.open({ path: testDbPath })
    search = new SemanticSearch({ vectorStore, embedding })
  })

  afterEach(async () => {
    await search.close()
    // Clean up test database
    try {
      await rm(testDbPath, { recursive: true, force: true })
    }
    catch {
      // Ignore cleanup errors
    }
  })

  describe('index', () => {
    it('should index a single document', async () => {
      await search.index({
        id: 'node-1',
        content: 'User authentication module',
        metadata: { type: 'function' },
      })

      const count = await search.count()
      expect(count).toBe(1)
    })

    it('should index multiple documents sequentially', async () => {
      await search.index({ id: 'node-1', content: 'Login handler' })
      await search.index({ id: 'node-2', content: 'Logout handler' })
      await search.index({ id: 'node-3', content: 'Session management' })

      const count = await search.count()
      expect(count).toBe(3)
    })
  })

  describe('indexBatch', () => {
    it('should index multiple documents in batch', async () => {
      await search.indexBatch([
        { id: 'node-1', content: 'User authentication' },
        { id: 'node-2', content: 'Password validation' },
        { id: 'node-3', content: 'Token generation' },
      ])

      const count = await search.count()
      expect(count).toBe(3)
    })

    it('should handle empty batch', async () => {
      await search.indexBatch([])
      const count = await search.count()
      expect(count).toBe(0)
    })

    it('should preserve metadata in batch indexing', async () => {
      await search.indexBatch([
        { id: 'node-1', content: 'Authentication', metadata: { type: 'module' } },
        { id: 'node-2', content: 'Validation', metadata: { type: 'function' } },
      ])

      // Search and check metadata is preserved
      const results = await search.search('Authentication', 2)
      const authResult = results.find(r => r.id === 'node-1')
      expect(authResult).toBeDefined()
      // metadata includes the 'text' key used for content retrieval
      expect(authResult?.metadata).toMatchObject({ type: 'module' })
    })
  })

  describe('search', () => {
    beforeEach(async () => {
      await search.indexBatch([
        { id: 'auth-1', content: 'User login and authentication handler' },
        { id: 'auth-2', content: 'User logout and session termination' },
        { id: 'db-1', content: 'Database connection pool manager' },
        { id: 'db-2', content: 'SQL query executor and result mapper' },
        { id: 'api-1', content: 'REST API endpoint handler' },
      ])
    })

    it('should return results for semantic query', async () => {
      const results = await search.search('user authentication', 3)

      expect(results.length).toBeGreaterThan(0)
      expect(results.length).toBeLessThanOrEqual(3)
      // Each result should have required fields
      for (const result of results) {
        expect(result.id).toBeDefined()
        expect(result.score).toBeDefined()
        expect(result.content).toBeDefined()
      }
    })

    it('should return results sorted by similarity', async () => {
      const results = await search.search('database', 5)

      // Scores are in descending order (higher cosine similarity = more similar)
      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score)
      }
    })

    it('should respect topK parameter', async () => {
      const results = await search.search('handler', 2)
      expect(results.length).toBeLessThanOrEqual(2)
    })
  })

  describe('searchByVector', () => {
    it('should search using pre-computed vector', async () => {
      await search.indexBatch([
        { id: 'node-1', content: 'Test content' },
        { id: 'node-2', content: 'Another test' },
      ])

      // Get embedding for search
      const embedding = search.getEmbedding()
      const queryVector = await embedding.embed('Test content')

      const results = await search.searchByVector(queryVector.vector, 2)
      expect(results.length).toBeGreaterThan(0)
    })
  })

  describe('delete', () => {
    it('should delete documents by ID', async () => {
      await search.indexBatch([
        { id: 'node-1', content: 'Content 1' },
        { id: 'node-2', content: 'Content 2' },
        { id: 'node-3', content: 'Content 3' },
      ])

      await search.delete(['node-1', 'node-3'])

      const count = await search.count()
      expect(count).toBe(1)
    })
  })

  describe('clear', () => {
    it('should clear all documents', async () => {
      await search.indexBatch([
        { id: 'node-1', content: 'Content 1' },
        { id: 'node-2', content: 'Content 2' },
      ])

      await search.clear()

      const count = await search.count()
      expect(count).toBe(0)
    })

    it('should be a no-op when VectorStore does not implement clear', async () => {
      // Build a minimal VectorStore without clear()
      const minimal: import('@pleaseai/rpg-store/vector-store').VectorStore = {
        open: async () => {},
        close: async () => {},
        upsert: async () => {},
        remove: async () => {},
        search: async () => [],
        count: async () => 0,
      }
      const { MockEmbedding } = await import('@pleaseai/rpg-encoder/embedding')
      const s = new (await import('@pleaseai/rpg-encoder/semantic-search')).SemanticSearch({
        vectorStore: minimal,
        embedding: new MockEmbedding(4),
      })
      // Should not throw
      await expect(s.clear()).resolves.toBeUndefined()
    })
  })

  describe('count', () => {
    it('should return 0 for empty store', async () => {
      const count = await search.count()
      expect(count).toBe(0)
    })

    it('should return correct count after indexing', async () => {
      await search.indexBatch([
        { id: 'node-1', content: 'Content 1' },
        { id: 'node-2', content: 'Content 2' },
      ])

      const count = await search.count()
      expect(count).toBe(2)
    })
  })

  describe('searchHybrid', () => {
    beforeEach(async () => {
      await search.indexBatch([
        { id: 'auth-1', content: 'User login and authentication handler' },
        { id: 'auth-2', content: 'User logout and session termination' },
        { id: 'db-1', content: 'Database connection pool manager' },
        { id: 'db-2', content: 'SQL query executor and result mapper' },
        { id: 'api-1', content: 'REST API endpoint handler' },
      ])
    })

    it('should return results for hybrid query', async () => {
      const results = await search.searchHybrid('user authentication', 3)

      expect(results.length).toBeGreaterThan(0)
      expect(results.length).toBeLessThanOrEqual(3)
      for (const result of results) {
        expect(result.id).toBeDefined()
        expect(result.score).toBeDefined()
        expect(result.content).toBeDefined()
      }
    })

    it('should respect topK parameter', async () => {
      const results = await search.searchHybrid('handler', 2)
      expect(results.length).toBeLessThanOrEqual(2)
    })

    it('should accept vectorWeight parameter', async () => {
      const results = await search.searchHybrid('database', 3, 0.3)
      expect(results.length).toBeGreaterThan(0)
    })
  })

  describe('searchFts', () => {
    beforeEach(async () => {
      await search.indexBatch([
        { id: 'auth-1', content: 'User login and authentication handler' },
        { id: 'db-1', content: 'Database connection pool manager' },
        { id: 'api-1', content: 'REST API endpoint handler' },
      ])
    })

    it('should return results for text query', async () => {
      const results = await search.searchFts('database connection', 3)

      expect(results.length).toBeGreaterThan(0)
      const ids = results.map(r => r.id)
      expect(ids).toContain('db-1')
    })

    it('delegates to vector search — returns indexed documents regardless of term', async () => {
      // searchFts falls back to vector search; with 3 indexed docs and topK=5, all are returned
      const results = await search.searchFts('zzzznonexistentterm', 5)
      expect(results.length).toBe(3)
      expect(results.length).toBeLessThanOrEqual(5)
    })
  })

  describe('getters', () => {
    it('should return embedding instance', () => {
      const embedding = search.getEmbedding()
      expect(embedding).toBeDefined()
      expect(embedding.getProvider()).toBe('Mock')
    })

    it('should return vector store instance', () => {
      const vectorStore = search.getVectorStore()
      expect(vectorStore).toBeDefined()
    })
  })
})
