import { describe, expect, it } from 'vitest'
import { MockEmbedding, OpenAIEmbedding } from '../../src/encoder/embedding'

describe('mockEmbedding', () => {
  it('should embed text and return correct dimension', async () => {
    const embedding = new MockEmbedding(128)
    const result = await embedding.embed('test text')

    expect(result.dimension).toBe(128)
    expect(result.vector).toHaveLength(128)
  })

  it('should generate deterministic vectors for same text', async () => {
    const embedding = new MockEmbedding(64)
    const result1 = await embedding.embed('hello world')
    const result2 = await embedding.embed('hello world')

    expect(result1.vector).toEqual(result2.vector)
  })

  it('should generate different vectors for different text', async () => {
    const embedding = new MockEmbedding(64)
    const result1 = await embedding.embed('hello')
    const result2 = await embedding.embed('world')

    expect(result1.vector).not.toEqual(result2.vector)
  })

  it('should embed batch of texts', async () => {
    const embedding = new MockEmbedding(32)
    const results = await embedding.embedBatch(['text1', 'text2', 'text3'])

    expect(results).toHaveLength(3)
    for (const result of results) {
      expect(result.dimension).toBe(32)
      expect(result.vector).toHaveLength(32)
    }
  })

  it('should handle empty batch', async () => {
    const embedding = new MockEmbedding()
    const results = await embedding.embedBatch([])

    expect(results).toHaveLength(0)
  })

  it('should return correct provider', () => {
    const embedding = new MockEmbedding()
    expect(embedding.getProvider()).toBe('Mock')
  })

  it('should return correct dimension', () => {
    const embedding = new MockEmbedding(256)
    expect(embedding.getDimension()).toBe(256)
  })

  it('should use default dimension of 1536', () => {
    const embedding = new MockEmbedding()
    expect(embedding.getDimension()).toBe(1536)
  })

  it('should generate normalized vectors (unit magnitude)', async () => {
    const embedding = new MockEmbedding(100)
    const result = await embedding.embed('test normalization')

    const magnitude = Math.sqrt(result.vector.reduce((sum, val) => sum + val * val, 0))
    expect(magnitude).toBeCloseTo(1.0, 5)
  })

  it('should handle empty string', async () => {
    const embedding = new MockEmbedding(64)
    const result = await embedding.embed('')

    expect(result.dimension).toBe(64)
    expect(result.vector).toHaveLength(64)
  })
})

describe('openAIEmbedding', () => {
  it('should return correct provider', () => {
    const embedding = new OpenAIEmbedding({ apiKey: 'test-key' })
    expect(embedding.getProvider()).toBe('OpenAI')
  })

  it('should use default model text-embedding-3-small', () => {
    const embedding = new OpenAIEmbedding({ apiKey: 'test-key' })
    expect(embedding.getModel()).toBe('text-embedding-3-small')
    expect(embedding.getDimension()).toBe(1536)
  })

  it('should accept custom model', () => {
    const embedding = new OpenAIEmbedding({
      apiKey: 'test-key',
      model: 'text-embedding-3-large',
    })
    expect(embedding.getModel()).toBe('text-embedding-3-large')
    expect(embedding.getDimension()).toBe(3072)
  })

  it('should return supported models list', () => {
    const models = OpenAIEmbedding.getSupportedModels()

    expect(models['text-embedding-3-small']).toBeDefined()
    expect(models['text-embedding-3-small'].dimension).toBe(1536)

    expect(models['text-embedding-3-large']).toBeDefined()
    expect(models['text-embedding-3-large'].dimension).toBe(3072)

    expect(models['text-embedding-ada-002']).toBeDefined()
  })

  // Integration test (skipped without real API key)
  it.skip('should generate real embeddings', async () => {
    const embedding = new OpenAIEmbedding({
      apiKey: process.env.OPENAI_API_KEY ?? '',
    })
    const result = await embedding.embed('test text')

    expect(result.dimension).toBe(1536)
    expect(result.vector).toHaveLength(1536)
  })
})
