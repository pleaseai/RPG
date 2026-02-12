import { describe, expect, it, vi } from 'vitest'
import { AISDKEmbedding, MockEmbedding, OpenAIEmbedding } from '../../src/encoder/embedding'

vi.mock('ai', () => ({
  embed: vi.fn(),
  embedMany: vi.fn(),
}))

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

  it('should embed text using AI SDK embed()', async () => {
    const { embed: embedFn } = await import('ai')

    const mockVector = Array.from({ length: 1536 }, (_, i) => i * 0.001)
    vi.mocked(embedFn).mockResolvedValueOnce({
      embedding: mockVector,
      usage: { tokens: 5 },
      value: 'test',
    } as any)

    const embedding = new OpenAIEmbedding({ apiKey: 'test-key' })
    const result = await embedding.embed('test text')

    expect(result.vector).toEqual(mockVector)
    expect(result.dimension).toBe(1536)
  })

  it('should embed batch using AI SDK embedMany()', async () => {
    const { embedMany: embedManyFn } = await import('ai')

    const mockEmbeddings = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]
    vi.mocked(embedManyFn).mockResolvedValueOnce({
      embeddings: mockEmbeddings,
      usage: { tokens: 10 },
      values: ['text1', 'text2'],
    } as any)

    const embedding = new OpenAIEmbedding({ apiKey: 'test-key' })
    const results = await embedding.embedBatch(['text1', 'text2'])

    expect(results).toHaveLength(2)
    expect(results[0].vector).toEqual([0.1, 0.2, 0.3])
    expect(results[1].vector).toEqual([0.4, 0.5, 0.6])
  })

  it('should handle empty batch', async () => {
    const embedding = new OpenAIEmbedding({ apiKey: 'test-key' })
    const results = await embedding.embedBatch([])
    expect(results).toHaveLength(0)
  })

  it('should wrap errors with OpenAI prefix', async () => {
    const { embed: embedFn } = await import('ai')
    vi.mocked(embedFn).mockRejectedValueOnce(new Error('Rate limit exceeded'))

    const embedding = new OpenAIEmbedding({ apiKey: 'test-key' })
    await expect(embedding.embed('test')).rejects.toThrow('Failed to generate OpenAI embedding')
  })

  it('should wrap batch errors with OpenAI prefix', async () => {
    const { embedMany: embedManyFn } = await import('ai')
    vi.mocked(embedManyFn).mockRejectedValueOnce(new Error('Timeout'))

    const embedding = new OpenAIEmbedding({ apiKey: 'test-key' })
    await expect(embedding.embedBatch(['text'])).rejects.toThrow('Failed to generate OpenAI batch embeddings')
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

describe('aISDKEmbedding', () => {
  it('should return custom provider name', () => {
    const mockModel = {} as any
    const embedding = new AISDKEmbedding({
      model: mockModel,
      providerName: 'TestProvider',
      dimension: 768,
    })
    expect(embedding.getProvider()).toBe('TestProvider')
  })

  it('should return default provider name AISDK', () => {
    const mockModel = {} as any
    const embedding = new AISDKEmbedding({ model: mockModel })
    expect(embedding.getProvider()).toBe('AISDK')
  })

  it('should return configured dimension', () => {
    const mockModel = {} as any
    const embedding = new AISDKEmbedding({ model: mockModel, dimension: 1024 })
    expect(embedding.getDimension()).toBe(1024)
  })

  it('should auto-detect dimension (0) by default', () => {
    const mockModel = {} as any
    const embedding = new AISDKEmbedding({ model: mockModel })
    expect(embedding.getDimension()).toBe(0)
  })

  it('should embed text using AI SDK embed()', async () => {
    const { embed: embedFn } = await import('ai')

    const mockVector = [0.1, 0.2, 0.3]
    vi.mocked(embedFn).mockResolvedValueOnce({
      embedding: mockVector,
      usage: { tokens: 5 },
      value: 'test',
    } as any)

    const mockModel = {} as any
    const embedding = new AISDKEmbedding({ model: mockModel, providerName: 'Test' })
    const result = await embedding.embed('test')

    expect(result.vector).toEqual(mockVector)
    expect(result.dimension).toBe(3)
    expect(embedding.getDimension()).toBe(3)
  })

  it('should embed batch using AI SDK embedMany()', async () => {
    const { embedMany: embedManyFn } = await import('ai')

    const mockEmbeddings = [[0.1, 0.2], [0.3, 0.4]]
    vi.mocked(embedManyFn).mockResolvedValueOnce({
      embeddings: mockEmbeddings,
      usage: { tokens: 10 },
      values: ['text1', 'text2'],
    } as any)

    const mockModel = {} as any
    const embedding = new AISDKEmbedding({ model: mockModel, providerName: 'Test' })
    const results = await embedding.embedBatch(['text1', 'text2'])

    expect(results).toHaveLength(2)
    expect(results[0].vector).toEqual([0.1, 0.2])
    expect(results[1].vector).toEqual([0.3, 0.4])
    expect(embedding.getDimension()).toBe(2)
  })

  it('should handle empty batch', async () => {
    const mockModel = {} as any
    const embedding = new AISDKEmbedding({ model: mockModel })
    const results = await embedding.embedBatch([])
    expect(results).toHaveLength(0)
  })

  it('should wrap errors with provider name', async () => {
    const { embed: embedFn } = await import('ai')
    vi.mocked(embedFn).mockRejectedValueOnce(new Error('API error'))

    const mockModel = {} as any
    const embedding = new AISDKEmbedding({ model: mockModel, providerName: 'Voyage' })

    await expect(embedding.embed('test')).rejects.toThrow('Failed to generate Voyage embedding')
  })
})
