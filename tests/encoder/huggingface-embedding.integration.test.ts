import { HuggingFaceEmbedding } from '@pleaseai/rpg-encoder/embedding'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Integration tests for HuggingFace embedding with MongoDB LEAF models
 *
 * Tests real HuggingFace embeddings using:
 * - MongoDB/mdbr-leaf-ir (Information Retrieval model)
 * - MongoDB/mdbr-leaf-mt (Multi-Task model)
 *
 * These tests download and run actual models, so they require:
 * - Internet connection (first run only, models are cached)
 * - ~500MB disk space for model weights
 * - Sufficient memory for model inference
 *
 * Note: First run may take 1-2 minutes to download model weights.
 * Subsequent runs use cached models and are much faster.
 */
describe('huggingFace Embedding Integration', () => {
  let irEmbedding: HuggingFaceEmbedding
  let mtEmbedding: HuggingFaceEmbedding

  beforeAll(async () => {
    // Create IR model embedding (default, with query prefix)
    irEmbedding = new HuggingFaceEmbedding({
      model: 'MongoDB/mdbr-leaf-ir',
      dtype: 'fp32',
    })

    // Create MT model embedding (no query prefix)
    mtEmbedding = new HuggingFaceEmbedding({
      model: 'MongoDB/mdbr-leaf-mt',
      dtype: 'fp32',
    })

    // Preload models to avoid timeout in individual tests
    console.log('[Integration] Preloading HuggingFace models...')
    await Promise.all([irEmbedding.preload(), mtEmbedding.preload()])
    console.log('[Integration] Models loaded successfully')
  }, 180000) // 3 minute timeout for model loading

  afterAll(() => {
    // Models are garbage collected automatically
    // No explicit cleanup needed
  })

  // ============================================================================
  // 1. Basic Embedding Generation
  // ============================================================================
  describe('basic embedding generation', () => {
    it('should generate embedding with correct dimension (768)', async () => {
      const result = await irEmbedding.embed('Hello, world!')

      expect(result.dimension).toBe(768)
      expect(result.vector).toHaveLength(768)
      expect(result.vector.every(v => typeof v === 'number')).toBe(true)
    })

    it('should generate non-zero vectors', async () => {
      const result = await irEmbedding.embed('Test embedding generation')

      const hasNonZero = result.vector.some(v => v !== 0)
      expect(hasNonZero).toBe(true)
    })

    it('should generate normalized vectors (approximately unit length)', async () => {
      const result = await irEmbedding.embed('Normalization test')

      const magnitude = Math.sqrt(result.vector.reduce((sum, v) => sum + v * v, 0))
      // LEAF models produce normalized embeddings
      expect(magnitude).toBeGreaterThan(0.9)
      expect(magnitude).toBeLessThan(1.1)
    })
  })

  // ============================================================================
  // 2. Semantic Similarity
  // ============================================================================
  describe('semantic similarity', () => {
    function cosineSimilarity(a: number[], b: number[]): number {
      const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0)
      const magnitudeA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0))
      const magnitudeB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0))
      return dotProduct / (magnitudeA * magnitudeB)
    }

    it('should produce similar embeddings for semantically similar texts', async () => {
      const [embed1, embed2, embed3] = await Promise.all([
        irEmbedding.embed('The quick brown fox jumps over the lazy dog'),
        irEmbedding.embed('A fast brown fox leaps over a sleepy dog'),
        irEmbedding.embed('The weather is nice today'),
      ])

      const similarityRelated = cosineSimilarity(embed1.vector, embed2.vector)
      const similarityUnrelated = cosineSimilarity(embed1.vector, embed3.vector)

      // Semantically similar sentences should have higher similarity
      expect(similarityRelated).toBeGreaterThan(similarityUnrelated)
      expect(similarityRelated).toBeGreaterThan(0.7) // High similarity expected
    })

    it('should distinguish between different code concepts', async () => {
      const [authCode, mathCode, unrelated] = await Promise.all([
        irEmbedding.embed(
          'function authenticate(user, password) { return validateCredentials(user, password); }',
        ),
        irEmbedding.embed('function calculateSum(a, b) { return a + b; }'),
        irEmbedding.embed(
          'function authenticate(username, pwd) { return checkPassword(username, pwd); }',
        ),
      ])

      const authSimilarity = cosineSimilarity(authCode.vector, unrelated.vector)
      const crossSimilarity = cosineSimilarity(authCode.vector, mathCode.vector)

      // Similar auth functions should be more similar than different concepts
      expect(authSimilarity).toBeGreaterThan(crossSimilarity)
    })
  })

  // ============================================================================
  // 3. Batch Embedding
  // ============================================================================
  describe('batch embedding', () => {
    it('should embed multiple texts in batch', async () => {
      const texts = ['First text to embed', 'Second text to embed', 'Third text to embed']

      const results = await irEmbedding.embedBatch(texts)

      expect(results).toHaveLength(3)
      for (const result of results) {
        expect(result.dimension).toBe(768)
        expect(result.vector).toHaveLength(768)
      }
    })

    it('should produce consistent results between single and batch embedding', async () => {
      const text = 'Consistency test text'

      const singleResult = await irEmbedding.embed(text)
      const batchResults = await irEmbedding.embedBatch([text])

      // Vectors should be identical
      expect(batchResults[0].vector).toEqual(singleResult.vector)
    })

    it('should handle large batch efficiently', async () => {
      const texts = Array.from({ length: 20 }, (_, i) => `Batch text number ${i + 1}`)

      const startTime = Date.now()
      const results = await irEmbedding.embedBatch(texts)
      const duration = Date.now() - startTime

      expect(results).toHaveLength(20)
      console.log(`[Integration] Batch of 20 texts embedded in ${duration}ms`)
    }, 60000)

    it('should handle empty batch', async () => {
      const results = await irEmbedding.embedBatch([])
      expect(results).toEqual([])
    })
  })

  // ============================================================================
  // 4. Model Variants (IR vs MT)
  // ============================================================================
  describe('model variants', () => {
    it('should produce different embeddings from IR and MT models', async () => {
      const text = 'Test text for model comparison'

      const irResult = await irEmbedding.embed(text)
      const mtResult = await mtEmbedding.embed(text)

      // IR model has 768 dimensions, MT model has 1024 dimensions
      expect(irResult.dimension).toBe(768)
      expect(mtResult.dimension).toBe(1024)

      // Vectors are different dimensions, so they are inherently different
      expect(irResult.vector).toHaveLength(768)
      expect(mtResult.vector).toHaveLength(1024)
    })

    it('should verify IR model has query prefix', () => {
      expect(irEmbedding.getQueryPrefix()).toBe(
        'Represent this sentence for searching relevant passages: ',
      )
    })

    it('should verify MT model has no query prefix', () => {
      expect(mtEmbedding.getQueryPrefix()).toBeUndefined()
    })

    it('should report correct model names', () => {
      expect(irEmbedding.getModel()).toBe('MongoDB/mdbr-leaf-ir')
      expect(mtEmbedding.getModel()).toBe('MongoDB/mdbr-leaf-mt')
    })
  })

  // ============================================================================
  // 5. Long Text Handling (Token Truncation)
  // ============================================================================
  describe('long text handling', () => {
    it('should handle text exceeding 512 token limit', async () => {
      // Generate long text (~1000+ tokens)
      const longText = Array.from(
        { length: 200 },
        (_, i) =>
          `This is sentence number ${i + 1} with some additional words to increase token count.`,
      ).join(' ')

      // Should not throw, truncation should handle it
      const result = await irEmbedding.embed(longText)

      expect(result.dimension).toBe(768)
      expect(result.vector).toHaveLength(768)
    })

    it('should handle very long code content', async () => {
      // Simulate a large code file
      const longCode = Array.from(
        { length: 100 },
        (_, i) => `
        export async function processItem${i}(item: Item): Promise<Result> {
          const validated = await validateItem(item);
          if (!validated) {
            throw new Error('Invalid item: ' + item.id);
          }
          return { success: true, data: transform(item) };
        }
      `,
      ).join('\n')

      const result = await irEmbedding.embed(longCode)

      expect(result.dimension).toBe(768)
      expect(result.vector).toHaveLength(768)
    })

    it('should handle batch with mixed length texts', async () => {
      const texts = [
        'Short text',
        Array.from({ length: 100 }, (_, i) => `Long sentence ${i}`).join(' '),
        'Another short text',
        Array.from({ length: 150 }, (_, i) => `Even longer sentence ${i}`).join(' '),
      ]

      const results = await irEmbedding.embedBatch(texts)

      expect(results).toHaveLength(4)
      for (const result of results) {
        expect(result.dimension).toBe(768)
        expect(result.vector).toHaveLength(768)
      }
    })
  })

  // ============================================================================
  // 6. Edge Cases
  // ============================================================================
  describe('edge cases', () => {
    it('should handle empty string', async () => {
      const result = await irEmbedding.embed('')

      expect(result.dimension).toBe(768)
      expect(result.vector).toHaveLength(768)
    })

    it('should handle whitespace-only string', async () => {
      const result = await irEmbedding.embed('   \n\t   ')

      expect(result.dimension).toBe(768)
      expect(result.vector).toHaveLength(768)
    })

    it('should handle special characters and unicode', async () => {
      const result = await irEmbedding.embed('Hello 🌍! Special chars: @#$%^&*() 한글 日本語')

      expect(result.dimension).toBe(768)
      expect(result.vector).toHaveLength(768)
    })

    it('should handle code with special syntax', async () => {
      const code = `
        const regex = /^[a-z]+$/gi;
        const template = \`Hello \${name}!\`;
        const obj = { [key]: value };
        const arrow = (x) => x * 2;
      `

      const result = await irEmbedding.embed(code)

      expect(result.dimension).toBe(768)
      expect(result.vector).toHaveLength(768)
    })
  })

  // ============================================================================
  // 7. Determinism
  // ============================================================================
  describe('determinism', () => {
    it('should produce identical embeddings for same input', async () => {
      const text = 'Determinism test input'

      const result1 = await irEmbedding.embed(text)
      const result2 = await irEmbedding.embed(text)

      // Vectors should be exactly identical
      expect(result1.vector).toEqual(result2.vector)
    })

    it('should produce identical batch results for same inputs', async () => {
      const texts = ['Text A', 'Text B', 'Text C']

      const batch1 = await irEmbedding.embedBatch(texts)
      const batch2 = await irEmbedding.embedBatch(texts)

      for (let i = 0; i < batch1.length; i++) {
        expect(batch1[i].vector).toEqual(batch2[i].vector)
      }
    })
  })

  // ============================================================================
  // 8. Concurrent Requests
  // ============================================================================
  describe('concurrent requests', () => {
    it('should handle concurrent embed calls correctly', async () => {
      const texts = ['Concurrent 1', 'Concurrent 2', 'Concurrent 3', 'Concurrent 4', 'Concurrent 5']

      const results = await Promise.all(texts.map(t => irEmbedding.embed(t)))

      expect(results).toHaveLength(5)
      for (const result of results) {
        expect(result.dimension).toBe(768)
        expect(result.vector).toHaveLength(768)
      }
    })

    it('should handle mixed concurrent single and batch calls', async () => {
      const [single1, batch, single2] = await Promise.all([
        irEmbedding.embed('Single call 1'),
        irEmbedding.embedBatch(['Batch 1', 'Batch 2']),
        irEmbedding.embed('Single call 2'),
      ])

      expect(single1.dimension).toBe(768)
      expect(single2.dimension).toBe(768)
      expect(batch).toHaveLength(2)
    })
  })

  // ============================================================================
  // 9. Provider Info
  // ============================================================================
  describe('provider info', () => {
    it('should report correct provider', () => {
      expect(irEmbedding.getProvider()).toBe('HuggingFace')
      expect(mtEmbedding.getProvider()).toBe('HuggingFace')
    })

    it('should report correct dtype', () => {
      expect(irEmbedding.getDtype()).toBe('fp32')
      expect(mtEmbedding.getDtype()).toBe('fp32')
    })

    it('should report model is loaded after preload', () => {
      expect(irEmbedding.isModelLoaded()).toBe(true)
      expect(mtEmbedding.isModelLoaded()).toBe(true)
    })
  })
})
