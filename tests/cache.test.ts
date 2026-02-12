import type { EntityInput, SemanticFeature } from '@pleaseai/rpg-encoder/semantic'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createCachedExtractor, SemanticCache } from '@pleaseai/rpg-encoder/cache'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const TEST_CACHE_DIR = '.test-cache'

describe('semanticCache', () => {
  let cache: SemanticCache

  beforeEach(() => {
    cache = new SemanticCache({
      cacheDir: TEST_CACHE_DIR,
      enabled: true,
    })
  })

  afterEach(async () => {
    cache.close()
    if (existsSync(TEST_CACHE_DIR)) {
      await rm(TEST_CACHE_DIR, { recursive: true })
    }
  })

  it('stores and retrieves features', async () => {
    const input: EntityInput = {
      type: 'function',
      name: 'testFunc',
      filePath: 'test.ts',
    }

    const feature: SemanticFeature = {
      description: 'test function',
      keywords: ['test'],
    }

    await cache.set(input, feature)
    const retrieved = await cache.get(input)

    expect(retrieved).toEqual(feature)
  })

  it('returns null for uncached entries', async () => {
    const input: EntityInput = {
      type: 'function',
      name: 'uncached',
      filePath: 'test.ts',
    }

    const result = await cache.get(input)

    expect(result).toBeNull()
  })

  it('invalidates cache when content changes', async () => {
    const input1: EntityInput = {
      type: 'function',
      name: 'testFunc',
      filePath: 'test.ts',
      sourceCode: 'original code',
    }

    const input2: EntityInput = {
      ...input1,
      sourceCode: 'modified code',
    }

    const feature: SemanticFeature = {
      description: 'test',
      keywords: [],
    }

    await cache.set(input1, feature)

    // Same input should return cached value
    const cached = await cache.get(input1)
    expect(cached).toEqual(feature)

    // Modified input should return null (hash changed)
    const uncached = await cache.get(input2)
    expect(uncached).toBeNull()
  })

  it('checks if entry exists', async () => {
    const input: EntityInput = {
      type: 'function',
      name: 'testFunc',
      filePath: 'test.ts',
    }

    expect(await cache.has(input)).toBe(false)

    await cache.set(input, { description: 'test', keywords: [] })

    expect(await cache.has(input)).toBe(true)
  })

  it('clears all entries', async () => {
    const input: EntityInput = {
      type: 'function',
      name: 'testFunc',
      filePath: 'test.ts',
    }

    await cache.set(input, { description: 'test', keywords: [] })
    expect(await cache.has(input)).toBe(true)

    await cache.clear()
    expect(await cache.has(input)).toBe(false)
  })

  it('persists cache to disk', async () => {
    const input: EntityInput = {
      type: 'function',
      name: 'testFunc',
      filePath: 'test.ts',
    }

    const feature: SemanticFeature = {
      description: 'persisted test',
      keywords: ['persist'],
    }

    await cache.set(input, feature)
    cache.close()

    // Create new cache instance pointing to same DB
    const newCache = new SemanticCache({
      cacheDir: TEST_CACHE_DIR,
      enabled: true,
    })

    const retrieved = await newCache.get(input)
    expect(retrieved).toEqual(feature)
    newCache.close()
  })

  it('returns stats', async () => {
    const stats = cache.getStats()

    expect(stats.enabled).toBe(true)
    expect(stats.size).toBe(0)

    await cache.set(
      { type: 'function', name: 'a', filePath: 'a.ts' },
      { description: 'a', keywords: [] },
    )

    const updatedStats = cache.getStats()
    expect(updatedStats.size).toBe(1)
  })

  it('respects disabled flag', async () => {
    const disabledCache = new SemanticCache({
      cacheDir: TEST_CACHE_DIR,
      enabled: false,
    })

    const input: EntityInput = {
      type: 'function',
      name: 'testFunc',
      filePath: 'test.ts',
    }

    await disabledCache.set(input, { description: 'test', keywords: [] })
    const result = await disabledCache.get(input)

    expect(result).toBeNull()
  })

  it('purges expired entries', async () => {
    const shortTtlCache = new SemanticCache({
      cacheDir: TEST_CACHE_DIR,
      ttl: 1, // 1ms TTL
      enabled: true,
    })

    const input: EntityInput = {
      type: 'function',
      name: 'testFunc',
      filePath: 'test.ts',
    }

    await shortTtlCache.set(input, { description: 'test', keywords: [] })

    // Wait for TTL to expire
    await new Promise(resolve => setTimeout(resolve, 10))

    await shortTtlCache.purge()

    // Stats should show 0 after purge
    const stats = shortTtlCache.getStats()
    expect(stats.size).toBe(0)
    shortTtlCache.close()
  })
})

describe('createCachedExtractor', () => {
  let cache: SemanticCache
  let extractCount: number

  beforeEach(() => {
    cache = new SemanticCache({
      cacheDir: TEST_CACHE_DIR,
      enabled: true,
    })
    extractCount = 0
  })

  afterEach(async () => {
    cache.close()
    if (existsSync(TEST_CACHE_DIR)) {
      await rm(TEST_CACHE_DIR, { recursive: true })
    }
  })

  it('wraps extractor with caching', async () => {
    const extractor = async (input: EntityInput): Promise<SemanticFeature> => {
      extractCount++
      return { description: `extracted ${input.name}`, keywords: [] }
    }

    const cachedExtractor = createCachedExtractor(extractor, cache)

    const input: EntityInput = {
      type: 'function',
      name: 'test',
      filePath: 'test.ts',
    }

    // First call should extract
    const result1 = await cachedExtractor(input)
    expect(result1.description).toBe('extracted test')
    expect(extractCount).toBe(1)

    // Second call should use cache
    const result2 = await cachedExtractor(input)
    expect(result2.description).toBe('extracted test')
    expect(extractCount).toBe(1) // Still 1, not called again
  })
})
