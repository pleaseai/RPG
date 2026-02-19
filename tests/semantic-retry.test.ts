import type { EntityInput } from '@pleaseai/rpg-encoder/semantic'
import { SemanticExtractor } from '@pleaseai/rpg-encoder/semantic'
import { describe, expect, it, vi } from 'vitest'

describe('SemanticExtractor multi-iteration extraction', () => {
  describe('maxParseIterations option', () => {
    it('has default maxParseIterations of 1 (backward compatible)', () => {
      const extractor = new SemanticExtractor({ useLLM: false })
      // Verify default via behavior: accessing private options through cast
      expect((extractor as any).options.maxParseIterations).toBe(1)
    })

    it('accepts custom maxParseIterations option', () => {
      const extractor = new SemanticExtractor({ useLLM: false, maxParseIterations: 3 })
      expect((extractor as any).options.maxParseIterations).toBe(3)
    })

    it('uses provided maxParseIterations from options', () => {
      const extractor = new SemanticExtractor({ useLLM: false, maxParseIterations: 5 })
      expect((extractor as any).options.maxParseIterations).toBe(5)
    })
  })

  describe('single-pass extraction (default behavior)', () => {
    it('extracts successfully with maxParseIterations=1', async () => {
      const extractor = new SemanticExtractor({ useLLM: false, maxParseIterations: 1 })

      const input: EntityInput = {
        type: 'function',
        name: 'validateUserInput',
        filePath: 'src/validation.ts',
      }

      const feature = await extractor.extract(input)

      expect(feature.description).toBeDefined()
      expect(feature.keywords).toBeDefined()
      expect(feature.keywords.length).toBeGreaterThan(0)
    })

    it('does not retry with maxParseIterations=1 on heuristic fallback', async () => {
      const extractor = new SemanticExtractor({ useLLM: false, maxParseIterations: 1 })

      const input: EntityInput = {
        type: 'function',
        name: 'processData',
        filePath: 'src/processor.ts',
      }

      const feature = await extractor.extract(input)

      // With useLLM: false, extraction uses heuristic directly (no LLM, no retry)
      expect(feature.description).toContain('transform')
      expect(extractor.getWarnings().length).toBe(0)
    })
  })

  describe('retry logic with LLM (when available)', () => {
    it('retries on LLM extraction failure with maxParseIterations > 1', async () => {
      const extractor = new SemanticExtractor({
        useLLM: true,
        maxParseIterations: 3,
        provider: 'google', // Will fail if no API key, but that's OK for testing retry logic
      })

      const input: EntityInput = {
        type: 'function',
        name: 'testFunction',
        filePath: 'src/test.ts',
        sourceCode: 'function testFunction() { return true; }',
      }

      // Spy on the private extractWithLLM method to verify retry attempts
      const extractWithLLMSpy = vi.spyOn(extractor as any, 'extractWithLLM')
      extractWithLLMSpy.mockRejectedValueOnce(new Error('API rate limit'))
      extractWithLLMSpy.mockRejectedValueOnce(new Error('Temporary error'))
      extractWithLLMSpy.mockResolvedValueOnce({
        description: 'test feature',
        keywords: ['test'],
      })

      const feature = await extractor.extract(input)

      // Should have attempted extraction 3 times before falling back
      expect(extractWithLLMSpy).toHaveBeenCalledTimes(3)
      expect(feature.description).toBe('test feature')
      expect(feature.keywords).toContain('test')

      extractWithLLMSpy.mockRestore()
    })

    it('falls back to heuristic after all LLM iterations fail', async () => {
      const extractor = new SemanticExtractor({
        useLLM: true,
        maxParseIterations: 2,
        provider: 'google',
      })

      const input: EntityInput = {
        type: 'function',
        name: 'getData',
        filePath: 'src/data.ts',
        sourceCode: 'function getData() { return data; }',
      }

      // Spy on extractWithLLM and always fail
      const extractWithLLMSpy = vi.spyOn(extractor as any, 'extractWithLLM')
      extractWithLLMSpy.mockRejectedValue(new Error('Persistent API error'))

      const feature = await extractor.extract(input)

      // Should have attempted exactly maxParseIterations times
      expect(extractWithLLMSpy).toHaveBeenCalledTimes(2)

      // Should fall back to heuristic
      expect(feature.description).toContain('retrieve')
      expect(feature.keywords).toContain('function')

      // Should have recorded warning
      const warnings = extractor.getWarnings()
      expect(warnings.length).toBeGreaterThan(0)
      expect(warnings[0]).toContain('getData')
      expect(warnings[0]).toContain('2 attempts')

      extractWithLLMSpy.mockRestore()
    })

    it('succeeds on second LLM attempt and returns LLM result (not heuristic)', async () => {
      const extractor = new SemanticExtractor({
        useLLM: true,
        maxParseIterations: 3,
        provider: 'google',
      })

      const input: EntityInput = {
        type: 'function',
        name: 'fetchUserData',
        filePath: 'src/api.ts',
        sourceCode: 'function fetchUserData(id) { return fetch("/api/users/" + id); }',
      }

      const extractWithLLMSpy = vi.spyOn(extractor as any, 'extractWithLLM')
      extractWithLLMSpy.mockRejectedValueOnce(new Error('Timeout'))
      extractWithLLMSpy.mockResolvedValueOnce({
        description: 'retrieve user information',
        keywords: ['user', 'fetch', 'api'],
      })

      const feature = await extractor.extract(input)

      // Should succeed on second attempt
      expect(extractWithLLMSpy).toHaveBeenCalledTimes(2)
      expect(feature.description).toBe('retrieve user information')
      expect(feature.keywords).toContain('user')

      // No warnings since LLM succeeded
      expect(extractor.getWarnings().length).toBe(0)

      extractWithLLMSpy.mockRestore()
    })

    it('logs debug messages for retry attempts', async () => {
      const extractor = new SemanticExtractor({
        useLLM: true,
        maxParseIterations: 2,
        provider: 'google',
      })

      const input: EntityInput = {
        type: 'function',
        name: 'processPayment',
        filePath: 'src/payment.ts',
        sourceCode: 'function processPayment() { }',
      }

      const extractWithLLMSpy = vi.spyOn(extractor as any, 'extractWithLLM')
      extractWithLLMSpy.mockRejectedValueOnce(new Error('Network error'))
      extractWithLLMSpy.mockRejectedValueOnce(new Error('Network error'))

      const feature = await extractor.extract(input)

      // Verify retry was attempted
      expect(extractWithLLMSpy).toHaveBeenCalledTimes(2)

      // Verify fallback was used
      expect(feature.description).toBeDefined()

      extractWithLLMSpy.mockRestore()
    })
  })

  describe('backward compatibility', () => {
    it('maintains original behavior when maxParseIterations not specified', async () => {
      const extractor = new SemanticExtractor({ useLLM: false })

      const input: EntityInput = {
        type: 'class',
        name: 'UserService',
        filePath: 'src/services/user.ts',
      }

      const feature = await extractor.extract(input)

      expect(feature.description).toContain('define')
      expect(feature.keywords).toContain('class')
    })

    it('preserves warnings array across multiple extractions', async () => {
      const extractor = new SemanticExtractor({
        useLLM: true,
        maxParseIterations: 1,
        provider: 'google',
      })

      const input1: EntityInput = {
        type: 'function',
        name: 'func1',
        filePath: 'src/file1.ts',
        sourceCode: 'function func1() { }',
      }

      const input2: EntityInput = {
        type: 'function',
        name: 'func2',
        filePath: 'src/file2.ts',
        sourceCode: 'function func2() { }',
      }

      const extractWithLLMSpy = vi.spyOn(extractor as any, 'extractWithLLM')
      extractWithLLMSpy.mockRejectedValue(new Error('API error'))

      await extractor.extract(input1)
      const warningsAfterFirst = extractor.getWarnings().length
      expect(warningsAfterFirst).toBeGreaterThan(0)

      await extractor.extract(input2)
      const warningsAfterSecond = extractor.getWarnings().length
      expect(warningsAfterSecond).toBeGreaterThan(warningsAfterFirst)

      extractWithLLMSpy.mockRestore()
    })
  })

  describe('warning message format', () => {
    it('includes attempt count in warning message', async () => {
      const extractor = new SemanticExtractor({
        useLLM: true,
        maxParseIterations: 3,
        provider: 'google',
      })

      const input: EntityInput = {
        type: 'function',
        name: 'criticalFunction',
        filePath: 'src/critical.ts',
        sourceCode: 'function criticalFunction() { }',
      }

      const extractWithLLMSpy = vi.spyOn(extractor as any, 'extractWithLLM')
      extractWithLLMSpy.mockRejectedValue(new Error('Persistent failure'))

      await extractor.extract(input)

      const warnings = extractor.getWarnings()
      const latestWarning = warnings[warnings.length - 1]

      expect(latestWarning).toContain('3 attempts')
      expect(latestWarning).toContain('criticalFunction')

      extractWithLLMSpy.mockRestore()
    })
  })
})
