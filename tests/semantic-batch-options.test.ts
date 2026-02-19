import type { EntityInput, SemanticOptions } from '@pleaseai/rpg-encoder/semantic'
import { SemanticExtractor } from '@pleaseai/rpg-encoder/semantic'
import { describe, expect, it } from 'vitest'

describe('SemanticOptions batch parameters', () => {
  describe('interface and type support', () => {
    it('SemanticOptions accepts minBatchTokens field', () => {
      const options: SemanticOptions = {
        useLLM: false,
        minBatchTokens: 5000,
      }

      expect(options.minBatchTokens).toBe(5000)
    })

    it('SemanticOptions accepts maxBatchTokens field', () => {
      const options: SemanticOptions = {
        useLLM: false,
        maxBatchTokens: 75000,
      }

      expect(options.maxBatchTokens).toBe(75000)
    })

    it('SemanticOptions accepts both batch parameter fields', () => {
      const options: SemanticOptions = {
        useLLM: false,
        minBatchTokens: 8000,
        maxBatchTokens: 60000,
      }

      expect(options.minBatchTokens).toBe(8000)
      expect(options.maxBatchTokens).toBe(60000)
    })
  })

  describe('SemanticExtractor constructor', () => {
    it('accepts minBatchTokens in constructor options', () => {
      const extractor = new SemanticExtractor({
        useLLM: false,
        minBatchTokens: 7000,
      })

      expect(extractor).toBeDefined()
    })

    it('accepts maxBatchTokens in constructor options', () => {
      const extractor = new SemanticExtractor({
        useLLM: false,
        maxBatchTokens: 80000,
      })

      expect(extractor).toBeDefined()
    })

    it('accepts both batch parameters in constructor options', () => {
      const extractor = new SemanticExtractor({
        useLLM: false,
        minBatchTokens: 9000,
        maxBatchTokens: 55000,
      })

      expect(extractor).toBeDefined()
    })
  })

  describe('default values', () => {
    it('applies default minBatchTokens when not provided', () => {
      const extractor = new SemanticExtractor({ useLLM: false })

      expect((extractor as any).options.minBatchTokens).toBe(10000)
    })

    it('applies default maxBatchTokens when not provided', () => {
      const extractor = new SemanticExtractor({ useLLM: false })

      expect((extractor as any).options.maxBatchTokens).toBe(50000)
    })

    it('preserves provided minBatchTokens instead of using default', () => {
      const customMin = 15000
      const extractor = new SemanticExtractor({
        useLLM: false,
        minBatchTokens: customMin,
      })

      expect((extractor as any).options.minBatchTokens).toBe(customMin)
    })

    it('preserves provided maxBatchTokens instead of using default', () => {
      const customMax = 100000
      const extractor = new SemanticExtractor({
        useLLM: false,
        maxBatchTokens: customMax,
      })

      expect((extractor as any).options.maxBatchTokens).toBe(customMax)
    })
  })

  describe('backward compatibility', () => {
    it('extractBatch works without specifying batch parameters', async () => {
      const extractor = new SemanticExtractor({ useLLM: false })

      const inputs: EntityInput[] = [
        { type: 'function', name: 'foo', filePath: 'a.ts' },
        { type: 'function', name: 'bar', filePath: 'b.ts' },
      ]

      const features = await extractor.extractBatch(inputs)

      expect(features).toHaveLength(2)
      expect(features[0].description).toBeDefined()
      expect(features[1].description).toBeDefined()
    })

    it('extract works without specifying batch parameters', async () => {
      const extractor = new SemanticExtractor({ useLLM: false })

      const input: EntityInput = {
        type: 'function',
        name: 'testFunction',
        filePath: 'test.ts',
      }

      const feature = await extractor.extract(input)

      expect(feature.description).toBeDefined()
      expect(feature.keywords).toContain('function')
    })

    it('existing options still work alongside new batch parameters', () => {
      const extractor = new SemanticExtractor({
        useLLM: false,
        maxTokens: 2048,
        minBatchTokens: 12000,
        maxBatchTokens: 65000,
      })

      expect(extractor).toBeDefined()
    })
  })

  describe('batch parameters with different values', () => {
    it('allows minBatchTokens to be less than maxBatchTokens', () => {
      const extractor = new SemanticExtractor({
        useLLM: false,
        minBatchTokens: 5000,
        maxBatchTokens: 50000,
      })

      expect(extractor).toBeDefined()
    })

    it('allows equal minBatchTokens and maxBatchTokens', () => {
      const extractor = new SemanticExtractor({
        useLLM: false,
        minBatchTokens: 25000,
        maxBatchTokens: 25000,
      })

      expect(extractor).toBeDefined()
    })

    it('allows minBatchTokens greater than default maxBatchTokens', () => {
      const extractor = new SemanticExtractor({
        useLLM: false,
        minBatchTokens: 60000,
        maxBatchTokens: 100000,
      })

      expect(extractor).toBeDefined()
    })

    it('handles zero values for batch parameters', () => {
      const extractor = new SemanticExtractor({
        useLLM: false,
        minBatchTokens: 0,
        maxBatchTokens: 0,
      })

      expect(extractor).toBeDefined()
    })

    it('handles very large batch parameter values', () => {
      const extractor = new SemanticExtractor({
        useLLM: false,
        minBatchTokens: 1000000,
        maxBatchTokens: 10000000,
      })

      expect(extractor).toBeDefined()
    })
  })

  describe('edge cases', () => {
    it('handles undefined batch parameters (uses defaults)', () => {
      const options: SemanticOptions = {
        useLLM: false,
        minBatchTokens: undefined,
        maxBatchTokens: undefined,
      }

      const extractor = new SemanticExtractor(options)

      expect(extractor).toBeDefined()
    })

    it('handles partially undefined batch parameters', () => {
      const options: SemanticOptions = {
        useLLM: false,
        minBatchTokens: 10000,
        maxBatchTokens: undefined,
      }

      const extractor = new SemanticExtractor(options)

      expect(extractor).toBeDefined()
    })

    it('creates extractor with empty options object', () => {
      const extractor = new SemanticExtractor({})

      expect(extractor).toBeDefined()
    })

    it('creates extractor with no options argument', () => {
      const extractor = new SemanticExtractor()

      expect(extractor).toBeDefined()
    })
  })
})
