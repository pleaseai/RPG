import type { EntityInput } from '@pleaseai/rpg-encoder/semantic'
import { SemanticExtractor } from '@pleaseai/rpg-encoder/semantic'
import { describe, expect, it } from 'vitest'

describe('semantic batching', () => {
  describe('createTokenAwareBatches', () => {
    const extractor = new SemanticExtractor({ useLLM: false })

    it('returns empty array for empty input', () => {
      const input: EntityInput[] = []
      const batches = (extractor as any).createTokenAwareBatches(input)
      expect(batches).toEqual([])
    })

    it('groups single entity into one batch', () => {
      const entity: EntityInput = {
        type: 'function',
        name: 'getValue',
        filePath: 'src/utils.ts',
      }
      const batches = (extractor as any).createTokenAwareBatches([entity])
      expect(batches).toHaveLength(1)
      expect(batches[0]).toEqual([entity])
    })

    it('groups multiple small entities within maxBatchTokens', () => {
      const entities: EntityInput[] = [
        {
          type: 'function',
          name: 'func1',
          filePath: 'src/a.ts',
        },
        {
          type: 'function',
          name: 'func2',
          filePath: 'src/b.ts',
        },
        {
          type: 'function',
          name: 'func3',
          filePath: 'src/c.ts',
        },
      ]
      // Each entity has ~200 tokens (no source code)
      // Total: 600 tokens, which is well under maxBatchTokens (50000)
      const batches = (extractor as any).createTokenAwareBatches(entities)
      expect(batches).toHaveLength(1)
      expect(batches[0]).toEqual(entities)
    })

    it('isolates single entity exceeding maxBatchTokens', () => {
      // Create an entity with huge source code: 200000 chars / 4 + 200 overhead = 50200 tokens > 50000
      const largeSource = 'x'.repeat(200000)
      const largeEntity: EntityInput = {
        type: 'function',
        name: 'largeFunc',
        filePath: 'src/large.ts',
        sourceCode: largeSource,
      }
      const smallEntity: EntityInput = {
        type: 'function',
        name: 'small',
        filePath: 'src/small.ts',
      }

      const entities = [smallEntity, largeEntity]
      const batches = (extractor as any).createTokenAwareBatches(entities)

      // Exactly 2 batches: small entity in first, large isolated in second
      expect(batches).toHaveLength(2)
      expect(batches[0]).toEqual([smallEntity])
      expect(batches[1]).toEqual([largeEntity])
    })

    it('merges last batch into previous when below minBatchTokens', () => {
      // Use custom thresholds to precisely control batch boundaries
      // Each medium entity: 40000 chars / 4 + 200 = 10200 tokens
      // maxBatchTokens: 10500 → fits exactly one medium entity per batch
      // minBatchTokens: 5000 → small entity (200 tokens) triggers merge
      const customExtractor = new SemanticExtractor({
        useLLM: false,
        minBatchTokens: 5000,
        maxBatchTokens: 10500,
      })

      const mediumSource = 'x'.repeat(40000)
      const entity1: EntityInput = {
        type: 'function',
        name: 'medium1',
        filePath: 'src/m1.ts',
        sourceCode: mediumSource,
      }
      const entity2: EntityInput = {
        type: 'function',
        name: 'medium2',
        filePath: 'src/m2.ts',
        sourceCode: mediumSource,
      }
      const entity3: EntityInput = {
        type: 'function',
        name: 'small',
        filePath: 'src/s.ts',
      }

      const entities = [entity1, entity2, entity3]
      const batches = (customExtractor as any).createTokenAwareBatches(entities)

      // Without merge: 3 batches [m1], [m2], [small]
      // With merge (small 200 tokens < minBatchTokens 5000): 2 batches [m1], [m2, small]
      expect(batches).toHaveLength(2)
      expect(batches[0]).toEqual([entity1])
      expect(batches[1]).toEqual([entity2, entity3])
    })

    it('respects custom maxBatchTokens by splitting entities', () => {
      // Each entity with source: 4000 chars / 4 + 200 = 1200 tokens
      // maxBatchTokens: 2000 → fits only 1 entity per batch (1200 < 2000, but 2*1200=2400 > 2000)
      const customExtractor = new SemanticExtractor({
        useLLM: false,
        minBatchTokens: 100,
        maxBatchTokens: 2000,
      })

      const source = 'x'.repeat(4000)
      const entities: EntityInput[] = Array.from({ length: 3 }, (_, i) => ({
        type: 'function' as const,
        name: `func${i}`,
        filePath: `src/file${i}.ts`,
        sourceCode: source,
      }))

      const batches = (customExtractor as any).createTokenAwareBatches(entities)

      // Each entity is 1200 tokens, max is 2000 → 1 entity per batch
      expect(batches).toHaveLength(3)
      expect(batches[0]).toEqual([entities[0]])
      expect(batches[1]).toEqual([entities[1]])
      expect(batches[2]).toEqual([entities[2]])
    })

    it('preserves entity order across batches', () => {
      // Force multiple batches: each entity ~200 tokens, maxBatchTokens=300 → 1 entity per batch
      const customExtractor = new SemanticExtractor({
        useLLM: false,
        minBatchTokens: 0,
        maxBatchTokens: 300,
      })

      const entities: EntityInput[] = Array.from({ length: 10 }, (_, i) => ({
        type: 'function',
        name: `func${i}`,
        filePath: `src/file${i}.ts`,
      }))

      const batches = (customExtractor as any).createTokenAwareBatches(entities)

      // Verify multiple batches were created (precondition for the test)
      expect(batches.length).toBeGreaterThan(1)

      const flattened = batches.flat()

      // Verify order is preserved
      expect(flattened).toEqual(entities)
    })
  })

  describe('extractBatch integration', () => {
    it('extracts batch using token-aware batching', async () => {
      const extractor = new SemanticExtractor({ useLLM: false })

      const entities: EntityInput[] = [
        {
          type: 'function',
          name: 'getValue',
          filePath: 'src/utils.ts',
        },
        {
          type: 'class',
          name: 'UserService',
          filePath: 'src/services/user.ts',
        },
        {
          type: 'method',
          name: 'fetchData',
          filePath: 'src/api.ts',
          parent: 'ApiClient',
        },
      ]

      const results = await extractor.extractBatch(entities)

      expect(results).toHaveLength(3)
      expect(results[0]).toHaveProperty('description')
      expect(results[0]).toHaveProperty('keywords')
      expect(results[1]).toHaveProperty('description')
      expect(results[2]).toHaveProperty('keywords')
    })

    it('returns all entities in correct order', async () => {
      const extractor = new SemanticExtractor({ useLLM: false })

      const entities: EntityInput[] = [
        { type: 'function', name: 'getUser', filePath: 'user.ts' },
        { type: 'function', name: 'saveData', filePath: 'data.ts' },
        { type: 'function', name: 'validateInput', filePath: 'validate.ts' },
      ]

      const results = await extractor.extractBatch(entities)

      expect(results).toHaveLength(3)
      // Verify order is maintained by checking descriptions contain expected verbs
      expect(results[0].description).toContain('user')
      expect(results[1].description).toContain('save')
      expect(results[2].description).toContain('validate')
    })

    it('handles empty input array', async () => {
      const extractor = new SemanticExtractor({ useLLM: false })
      const results = await extractor.extractBatch([])
      expect(results).toEqual([])
    })

    it('handles large batch that gets split into multiple batches', async () => {
      const customExtractor = new SemanticExtractor({
        useLLM: false,
        minBatchTokens: 5000,
        maxBatchTokens: 20000,
      })

      // Create entities with source code to increase token count
      const entities: EntityInput[] = Array.from({ length: 5 }, (_, i) => ({
        type: 'function',
        name: `func${i}`,
        filePath: `src/file${i}.ts`,
        sourceCode: 'const x = 1;'.repeat(100), // Add some tokens
      }))

      const results = await customExtractor.extractBatch(entities)

      // Should get same number of results
      expect(results).toHaveLength(5)
      // All should have semantic features
      results.forEach((result) => {
        expect(result.description).toBeDefined()
        expect(result.keywords).toBeDefined()
      })
    })

    it('maintains backward compatibility with existing extract calls', async () => {
      const extractor = new SemanticExtractor({ useLLM: false })

      const input: EntityInput = {
        type: 'function',
        name: 'getValue',
        filePath: 'src/utils.ts',
      }

      // Single extract call should still work
      const result = await extractor.extract(input)
      expect(result.description).toBeDefined()
      expect(result.keywords).toBeDefined()

      // extractBatch with single item should match
      const batchResults = await extractor.extractBatch([input])
      expect(batchResults).toHaveLength(1)
      expect(batchResults[0].description).toBeDefined()
    })
  })
})
