import { LLMClient } from '@pleaseai/rpg-utils/llm'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn(() => 'mock-model')),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => 'mock-model')),
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn(() => 'mock-model')),
}))

vi.mock('ai', () => ({
  generateText: vi.fn(),
  Output: {
    object: vi.fn(({ schema }: any) => ({ type: 'object', schema })),
  },
}))

describe('LLMClient', () => {
  describe('constructor', () => {
    it('should use default model for openai provider', () => {
      const client = new LLMClient({ provider: 'openai' })
      expect(client.getModel()).toBe('gpt-4o')
      expect(client.getProvider()).toBe('openai')
    })

    it('should use default model for anthropic provider', () => {
      const client = new LLMClient({ provider: 'anthropic' })
      expect(client.getModel()).toBe('claude-sonnet-4.5')
    })

    it('should use default model for google provider', () => {
      const client = new LLMClient({ provider: 'google' })
      expect(client.getModel()).toBe('gemini-3-flash-preview')
    })

    it('should accept custom model', () => {
      const client = new LLMClient({ provider: 'openai', model: 'gpt-5' })
      expect(client.getModel()).toBe('gpt-5')
    })
  })

  describe('complete', () => {
    it('should return generated text with usage stats', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'Hello, world!',
        usage: { inputTokens: 10, outputTokens: 5 },
      } as any)

      const client = new LLMClient({ provider: 'openai' })
      const result = await client.complete('Say hello')

      expect(result.content).toBe('Hello, world!')
      expect(result.usage.promptTokens).toBe(10)
      expect(result.usage.completionTokens).toBe(5)
      expect(result.usage.totalTokens).toBe(15)
      expect(result.model).toBe('gpt-4o')
    })

    it('should pass system prompt to generateText', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'response',
        usage: { inputTokens: 5, outputTokens: 3 },
      } as any)

      const client = new LLMClient({ provider: 'openai' })
      await client.complete('prompt', 'system prompt')

      expect(vi.mocked(generateText)).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'system prompt',
          prompt: 'prompt',
        }),
      )
    })

    it('should handle missing usage data gracefully', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'response',
        usage: undefined,
      } as any)

      const client = new LLMClient({ provider: 'openai' })
      const result = await client.complete('prompt')

      expect(result.usage.promptTokens).toBe(0)
      expect(result.usage.completionTokens).toBe(0)
      expect(result.usage.totalTokens).toBe(0)
    })

    it('should throw and call onError on failure', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockRejectedValueOnce(new Error('API timeout'))

      const onError = vi.fn()
      const client = new LLMClient({ provider: 'openai', onError })

      await expect(client.complete('prompt')).rejects.toThrow('API timeout')
      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ model: 'gpt-4o' }),
      )
    })
  })

  describe('completeJSON', () => {
    it('should return structured output when schema is provided', async () => {
      const { generateText } = await import('ai')

      const schema = z.object({ name: z.string() })
      vi.mocked(generateText).mockResolvedValueOnce({
        output: { name: 'test' },
        usage: { inputTokens: 10, outputTokens: 5 },
      } as any)

      const client = new LLMClient({ provider: 'openai' })
      const result = await client.completeJSON('prompt', 'system', schema)

      expect(result).toEqual({ name: 'test' })
    })

    it('should throw when structured output is null', async () => {
      const { generateText } = await import('ai')

      const schema = z.object({ name: z.string() })
      vi.mocked(generateText).mockResolvedValueOnce({
        output: null,
        usage: { inputTokens: 10, outputTokens: 5 },
      } as any)

      const client = new LLMClient({ provider: 'openai' })
      await expect(client.completeJSON('prompt', 'system', schema))
        .rejects
        .toThrow('No structured output returned from model')
    })

    it('should extract JSON from code block when no schema', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: '```json\n{"key": "value"}\n```',
        usage: { inputTokens: 10, outputTokens: 5 },
      } as any)

      const client = new LLMClient({ provider: 'openai' })
      const result = await client.completeJSON<{ key: string }>('prompt')

      expect(result).toEqual({ key: 'value' })
    })

    it('should extract bare JSON object when no schema and no code block', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'Here is the result: {"key": "value"}',
        usage: { inputTokens: 10, outputTokens: 5 },
      } as any)

      const client = new LLMClient({ provider: 'openai' })
      const result = await client.completeJSON<{ key: string }>('prompt')

      expect(result).toEqual({ key: 'value' })
    })

    it('should throw when no JSON found in response', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'No JSON here at all',
        usage: { inputTokens: 10, outputTokens: 5 },
      } as any)

      const client = new LLMClient({ provider: 'openai' })
      await expect(client.completeJSON('prompt'))
        .rejects
        .toThrow('No JSON found in response')
    })
  })

  describe('usage tracking', () => {
    it('should accumulate usage stats across requests', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText)
        .mockResolvedValueOnce({
          text: 'first',
          usage: { inputTokens: 10, outputTokens: 5 },
        } as any)
        .mockResolvedValueOnce({
          text: 'second',
          usage: { inputTokens: 20, outputTokens: 10 },
        } as any)

      const client = new LLMClient({ provider: 'openai' })
      await client.complete('prompt1')
      await client.complete('prompt2')

      const stats = client.getUsageStats()
      expect(stats.totalPromptTokens).toBe(30)
      expect(stats.totalCompletionTokens).toBe(15)
      expect(stats.totalTokens).toBe(45)
      expect(stats.requestCount).toBe(2)
    })

    it('should reset usage stats', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'response',
        usage: { inputTokens: 10, outputTokens: 5 },
      } as any)

      const client = new LLMClient({ provider: 'openai' })
      await client.complete('prompt')
      client.resetUsageStats()

      const stats = client.getUsageStats()
      expect(stats.totalPromptTokens).toBe(0)
      expect(stats.totalCompletionTokens).toBe(0)
      expect(stats.requestCount).toBe(0)
    })
  })

  describe('estimateCost', () => {
    it('should estimate cost for known model', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'response',
        usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
      } as any)

      const client = new LLMClient({ provider: 'openai', model: 'gpt-4o' })
      await client.complete('prompt')

      const cost = client.estimateCost()
      expect(cost.inputCost).toBe(2.50) // $2.50/M input
      expect(cost.outputCost).toBe(5.00) // $10.00/M * 0.5M
      expect(cost.totalCost).toBe(7.50)
    })

    it('should return zero cost for unknown model', () => {
      const client = new LLMClient({ provider: 'openai', model: 'unknown-model' })
      const cost = client.estimateCost()

      expect(cost.totalCost).toBe(0)
    })

    it('should accept custom stats for cost estimation', () => {
      const client = new LLMClient({ provider: 'openai', model: 'gpt-4o' })
      const cost = client.estimateCost({
        totalPromptTokens: 2_000_000,
        totalCompletionTokens: 1_000_000,
        totalTokens: 3_000_000,
        requestCount: 10,
      })

      expect(cost.inputCost).toBe(5.00)
      expect(cost.outputCost).toBe(10.00)
      expect(cost.totalCost).toBe(15.00)
    })
  })
})
