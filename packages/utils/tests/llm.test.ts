import { LLMClient, parseModelString } from '@pleaseai/soop-utils/llm'
import { Memory } from '@pleaseai/soop-utils/memory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

vi.mock('ai-sdk-provider-claude-code', () => ({
  createClaudeCode: vi.fn(() => vi.fn(() => 'mock-claude-code-model')),
}))

vi.mock('ai-sdk-provider-gemini-cli', () => ({
  createGeminiProvider: vi.fn(() => vi.fn(() => 'mock-gemini-cli-model')),
}))

const { mockCreateCodexCli, MockNoObjectGeneratedError } = vi.hoisted(() => {
  class MockNoObjectGeneratedError extends Error {
    readonly text: string
    constructor(message: string, text: string) {
      super(message)
      this.text = text
    }

    static isInstance(err: unknown): err is MockNoObjectGeneratedError {
      return err instanceof MockNoObjectGeneratedError
    }
  }
  return {
    mockCreateCodexCli: vi.fn(() => vi.fn(() => 'mock-codex-model')),
    MockNoObjectGeneratedError,
  }
})

vi.mock('ai-sdk-provider-codex-cli', () => ({
  createCodexCli: mockCreateCodexCli,
}))

vi.mock('ai', () => ({
  generateText: vi.fn(),
  Output: {
    object: vi.fn(({ schema }: any) => ({ type: 'object', schema })),
  },
  NoObjectGeneratedError: MockNoObjectGeneratedError,
}))

describe('parseModelString', () => {
  it('should parse provider/model format', () => {
    expect(parseModelString('openai/gpt-5.2')).toEqual({ provider: 'openai', model: 'gpt-5.2' })
  })

  it('should parse claude-code/haiku', () => {
    expect(parseModelString('claude-code/haiku')).toEqual({ provider: 'claude-code', model: 'haiku' })
  })

  it('should parse claude-code/sonnet', () => {
    expect(parseModelString('claude-code/sonnet')).toEqual({ provider: 'claude-code', model: 'sonnet' })
  })

  it('should parse codex/gpt-5.3-codex', () => {
    expect(parseModelString('codex/gpt-5.3-codex')).toEqual({ provider: 'codex', model: 'gpt-5.3-codex' })
  })

  it('should parse gemini-cli', () => {
    expect(parseModelString('gemini-cli')).toEqual({ provider: 'gemini-cli', model: undefined })
  })

  it('should parse gemini-cli/gemini-2.5-pro', () => {
    expect(parseModelString('gemini-cli/gemini-2.5-pro')).toEqual({ provider: 'gemini-cli', model: 'gemini-2.5-pro' })
  })

  it('should parse provider-only string (no slash)', () => {
    expect(parseModelString('google')).toEqual({ provider: 'google', model: undefined })
  })

  it('should throw for unknown provider', () => {
    expect(() => parseModelString('invalid/model')).toThrow('Unknown LLM provider: "invalid"')
  })

  it('should treat trailing slash as provider-only', () => {
    expect(parseModelString('openai/')).toEqual({ provider: 'openai', model: undefined })
  })

  it('should handle model with slashes (e.g., org/model)', () => {
    expect(parseModelString('openai/org/model-name')).toEqual({ provider: 'openai', model: 'org/model-name' })
  })
})

describe('LLMClient', () => {
  describe('constructor', () => {
    it('should use default model for openai provider', () => {
      const client = new LLMClient({ provider: 'openai' })
      expect(client.getModel()).toBe('gpt-5')
      expect(client.getProvider()).toBe('openai')
    })

    it('should use default model for anthropic provider', () => {
      const client = new LLMClient({ provider: 'anthropic' })
      expect(client.getModel()).toBe('claude-sonnet-4-6')
    })

    it('should use default model for google provider', () => {
      const client = new LLMClient({ provider: 'google' })
      expect(client.getModel()).toBe('gemini-3.1-flash-lite-preview')
    })

    it('should use default model for claude-code provider', () => {
      const client = new LLMClient({ provider: 'claude-code' })
      expect(client.getModel()).toBe('haiku')
      expect(client.getProvider()).toBe('claude-code')
    })

    it('should accept custom model for claude-code provider', () => {
      const client = new LLMClient({ provider: 'claude-code', model: 'opus' })
      expect(client.getModel()).toBe('opus')
    })

    it('should use default model for codex provider', () => {
      const client = new LLMClient({ provider: 'codex' })
      expect(client.getModel()).toBe('gpt-5.3-codex')
      expect(client.getProvider()).toBe('codex')
    })

    it('should accept custom model for codex provider', () => {
      const client = new LLMClient({ provider: 'codex', model: 'gpt-5.2-codex' })
      expect(client.getModel()).toBe('gpt-5.2-codex')
    })

    it('should use default model for gemini-cli provider', () => {
      const client = new LLMClient({ provider: 'gemini-cli' })
      expect(client.getModel()).toBe('gemini-3.1-flash-lite-preview')
      expect(client.getProvider()).toBe('gemini-cli')
    })

    it('should accept custom model for gemini-cli provider', () => {
      const client = new LLMClient({ provider: 'gemini-cli', model: 'gemini-2.5-pro' })
      expect(client.getModel()).toBe('gemini-2.5-pro')
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
      expect(result.model).toBe('gpt-5')
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

    it('should call generateText with claude-code provider', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'claude-code response',
        usage: { inputTokens: 8, outputTokens: 4 },
      } as any)

      const client = new LLMClient({ provider: 'claude-code' })
      const result = await client.complete('test prompt')

      expect(result.content).toBe('claude-code response')
      expect(result.model).toBe('haiku')
    })

    it('should pass claudeCodeSettings to createClaudeCode', async () => {
      const { createClaudeCode } = await import('ai-sdk-provider-claude-code')
      vi.mocked(createClaudeCode).mockClear()

      const settings = {
        cwd: '/tmp/test',
        permissionMode: 'bypassPermissions' as const,
        maxTurns: 5,
        allowedTools: ['Read', 'Write'],
      }

      const _client = new LLMClient({ provider: 'claude-code', claudeCodeSettings: settings })
      expect(_client).toBeDefined()

      expect(vi.mocked(createClaudeCode)).toHaveBeenCalledWith({ defaultSettings: settings })
    })

    it('should call createClaudeCode with undefined when no settings provided', async () => {
      const { createClaudeCode } = await import('ai-sdk-provider-claude-code')
      vi.mocked(createClaudeCode).mockClear()

      const _client = new LLMClient({ provider: 'claude-code' })
      expect(_client).toBeDefined()

      expect(vi.mocked(createClaudeCode)).toHaveBeenCalledWith(undefined)
    })

    it('should not pass apiKey to createClaudeCode', async () => {
      const { createClaudeCode } = await import('ai-sdk-provider-claude-code')
      vi.mocked(createClaudeCode).mockClear()

      const _client = new LLMClient({ provider: 'claude-code', apiKey: 'should-be-ignored' })
      expect(_client).toBeDefined()

      expect(vi.mocked(createClaudeCode)).toHaveBeenCalledWith(undefined)
    })

    it('should call generateText with codex provider', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'codex response',
        usage: { inputTokens: 8, outputTokens: 4 },
      } as any)

      const client = new LLMClient({ provider: 'codex' })
      const result = await client.complete('test prompt')

      expect(result.content).toBe('codex response')
      expect(result.model).toBe('gpt-5.3-codex')
    })

    it('should pass codexSettings to createCodexCli', () => {
      mockCreateCodexCli.mockClear()

      const settings = {
        cwd: '/tmp/test',
      }

      const client = new LLMClient({ provider: 'codex', codexSettings: settings })

      expect(client).toBeDefined()
      expect(mockCreateCodexCli).toHaveBeenCalledWith({ defaultSettings: settings })
    })

    it('should call generateText with gemini-cli provider', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'gemini-cli response',
        usage: { inputTokens: 8, outputTokens: 4 },
      } as any)

      const client = new LLMClient({ provider: 'gemini-cli' })
      const result = await client.complete('test prompt')

      expect(result.content).toBe('gemini-cli response')
      expect(result.model).toBe('gemini-3.1-flash-lite-preview')
    })

    it('should pass geminiCliSettings to createGeminiProvider', async () => {
      const { createGeminiProvider } = await import('ai-sdk-provider-gemini-cli')
      vi.mocked(createGeminiProvider).mockClear()

      const settings = { authType: 'api-key' as const, apiKey: 'test-key' }
      const _client = new LLMClient({ provider: 'gemini-cli', geminiCliSettings: settings })
      expect(_client).toBeDefined()

      expect(vi.mocked(createGeminiProvider)).toHaveBeenCalledWith(settings)
    })

    it('should call createGeminiProvider with empty object when no settings provided', async () => {
      const { createGeminiProvider } = await import('ai-sdk-provider-gemini-cli')
      vi.mocked(createGeminiProvider).mockClear()

      const _client = new LLMClient({ provider: 'gemini-cli' })
      expect(_client).toBeDefined()

      expect(vi.mocked(createGeminiProvider)).toHaveBeenCalledWith({})
    })

    it('should not pass apiKey to createGeminiProvider', async () => {
      const { createGeminiProvider } = await import('ai-sdk-provider-gemini-cli')
      vi.mocked(createGeminiProvider).mockClear()

      const _client = new LLMClient({ provider: 'gemini-cli', apiKey: 'should-be-ignored' })
      expect(_client).toBeDefined()

      expect(vi.mocked(createGeminiProvider)).toHaveBeenCalledWith({})
    })

    it('should call createCodexCli with undefined when no settings provided', () => {
      mockCreateCodexCli.mockClear()

      const client = new LLMClient({ provider: 'codex' })

      expect(client).toBeDefined()
      expect(mockCreateCodexCli).toHaveBeenCalledWith(undefined)
    })

    it('should not pass apiKey to createCodexCli', () => {
      mockCreateCodexCli.mockClear()

      const client = new LLMClient({ provider: 'codex', apiKey: 'should-be-ignored' })

      expect(client).toBeDefined()
      expect(mockCreateCodexCli).toHaveBeenCalledWith(undefined)
    })

    it('should pass googleSettings.thinkingConfig via providerOptions', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'google response',
        usage: { inputTokens: 8, outputTokens: 4 },
      } as any)

      const client = new LLMClient({
        provider: 'google',
        googleSettings: { thinkingConfig: { thinkingLevel: 'low' } },
      })
      await client.complete('test prompt')

      expect(vi.mocked(generateText)).toHaveBeenCalledWith(
        expect.objectContaining({
          providerOptions: { google: { thinkingConfig: { thinkingLevel: 'low' } } },
        }),
      )
    })

    it('should not pass providerOptions when no googleSettings', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'google response',
        usage: { inputTokens: 8, outputTokens: 4 },
      } as any)

      const client = new LLMClient({ provider: 'google' })
      await client.complete('test prompt')

      expect(vi.mocked(generateText)).toHaveBeenCalledWith(
        expect.objectContaining({
          providerOptions: undefined,
        }),
      )
    })

    it('should give callOptions.providerOptions priority over instance googleSettings', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'response',
        usage: { inputTokens: 5, outputTokens: 3 },
      } as any)

      const client = new LLMClient({
        provider: 'google',
        googleSettings: { thinkingConfig: { thinkingLevel: 'high' } },
      })
      const callProviderOptions = { google: { thinkingConfig: { thinkingLevel: 'none' } } } as any
      await client.complete('prompt', undefined, { providerOptions: callProviderOptions })

      expect(vi.mocked(generateText)).toHaveBeenCalledWith(
        expect.objectContaining({
          providerOptions: callProviderOptions,
        }),
      )
    })

    it('should forward headers from callOptions to generateText in complete()', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'response',
        usage: { inputTokens: 5, outputTokens: 3 },
      } as any)

      const client = new LLMClient({ provider: 'openai' })
      await client.complete('prompt', undefined, { headers: { Authorization: 'Bearer token' } })

      expect(vi.mocked(generateText)).toHaveBeenCalledWith(
        expect.objectContaining({ headers: { Authorization: 'Bearer token' } }),
      )
    })

    it('should forward maxApiRetries from callOptions to generateText in complete()', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'response',
        usage: { inputTokens: 5, outputTokens: 3 },
      } as any)

      const client = new LLMClient({ provider: 'openai' })
      await client.complete('prompt', undefined, { maxApiRetries: 3 })

      expect(vi.mocked(generateText)).toHaveBeenCalledWith(
        expect.objectContaining({ maxRetries: 3 }),
      )
    })

    it('should default to 32768 maxOutputTokens', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'response',
        usage: { inputTokens: 5, outputTokens: 3 },
      } as any)

      const client = new LLMClient({ provider: 'openai' })
      await client.complete('prompt')

      expect(vi.mocked(generateText)).toHaveBeenCalledWith(
        expect.objectContaining({ maxOutputTokens: 32768 }),
      )
    })

    it('should use callOptions.maxTokens over instance maxTokens', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'response',
        usage: { inputTokens: 5, outputTokens: 3 },
      } as any)

      const client = new LLMClient({ provider: 'openai', maxTokens: 1024 })
      await client.complete('prompt', undefined, { maxTokens: 8192 })

      expect(vi.mocked(generateText)).toHaveBeenCalledWith(
        expect.objectContaining({ maxOutputTokens: 8192 }),
      )
    })

    it('should use instance maxTokens when callOptions.maxTokens not provided', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'response',
        usage: { inputTokens: 5, outputTokens: 3 },
      } as any)

      const client = new LLMClient({ provider: 'openai', maxTokens: 1024 })
      await client.complete('prompt')

      expect(vi.mocked(generateText)).toHaveBeenCalledWith(
        expect.objectContaining({ maxOutputTokens: 1024 }),
      )
    })

    it('should throw and call onError on failure', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockRejectedValueOnce(new Error('API timeout'))

      const onError = vi.fn()
      const client = new LLMClient({ provider: 'openai', onError })

      await expect(client.complete('prompt')).rejects.toThrow('API timeout')
      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ model: 'gpt-5' }),
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

    it('should fall back to text parsing when NoObjectGeneratedError is thrown with valid JSON', async () => {
      const { generateText } = await import('ai')

      const schema = z.object({ name: z.string() })
      const fakeError = new MockNoObjectGeneratedError('No object generated', '{"name": "fallback"}')
      vi.mocked(generateText).mockRejectedValueOnce(fakeError)

      const client = new LLMClient({ provider: 'openai' })
      const result = await client.completeJSON('prompt', 'system', schema)

      expect(result).toEqual({ name: 'fallback' })
    })

    it('should throw structured error when NoObjectGeneratedError text fallback parse fails', async () => {
      const { generateText } = await import('ai')

      const schema = z.object({ name: z.string() })
      const fakeError = new MockNoObjectGeneratedError('No object generated', '{broken json}')
      vi.mocked(generateText).mockRejectedValueOnce(fakeError)

      const client = new LLMClient({ provider: 'openai' })
      await expect(client.completeJSON('prompt', 'system', schema))
        .rejects
        .toThrow('Structured output fallback parse failed (NoObjectGeneratedError → text → parse)')
    })

    it('should re-throw non-NoObjectGeneratedError from generateText', async () => {
      const { generateText } = await import('ai')

      const schema = z.object({ name: z.string() })
      vi.mocked(generateText).mockRejectedValueOnce(new Error('network error'))

      const client = new LLMClient({ provider: 'openai' })
      await expect(client.completeJSON('prompt', 'system', schema))
        .rejects
        .toThrow('network error')
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

  describe('generate', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should call generateText with messages parameter', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'multi-turn response',
        usage: { inputTokens: 10, outputTokens: 5 },
      } as any)

      const client = new LLMClient({ provider: 'openai' })
      const memory = new Memory()
      memory.addSystem('You are helpful.').addUser('Hello')

      const result = await client.generate(memory)

      expect(result.content).toBe('multi-turn response')
      expect(result.model).toBe('gpt-5')
      expect(vi.mocked(generateText)).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }),
            expect.objectContaining({ role: 'user' }),
          ]),
        }),
      )
    })

    it('should NOT pass prompt or system to generateText (uses messages instead)', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'response',
        usage: { inputTokens: 5, outputTokens: 3 },
      } as any)

      const client = new LLMClient({ provider: 'openai' })
      const memory = new Memory()
      memory.addUser('test')

      await client.generate(memory)

      expect(vi.mocked(generateText)).toHaveBeenCalledWith(
        expect.not.objectContaining({ prompt: expect.anything() }),
      )
    })

    it('should retry on transient errors up to maxRetries times', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText)
        .mockRejectedValueOnce(new Error('API error'))
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce({
          text: 'recovered',
          usage: { inputTokens: 5, outputTokens: 3 },
        } as any)

      const client = new LLMClient({ provider: 'openai' })
      const memory = new Memory()
      memory.addUser('test')

      const result = await client.generate(memory, { maxRetries: 3 })
      expect(result.content).toBe('recovered')
      expect(vi.mocked(generateText)).toHaveBeenCalledTimes(3)
    })

    it('should throw after exhausting maxRetries', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockRejectedValue(new Error('persistent error'))

      const client = new LLMClient({ provider: 'openai' })
      const memory = new Memory()
      memory.addUser('test')

      await expect(client.generate(memory, { maxRetries: 2 })).rejects.toThrow('persistent error')
      expect(vi.mocked(generateText)).toHaveBeenCalledTimes(2)
    })

    it('should truncate context on context_length_exceeded without consuming retry count', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText)
        .mockRejectedValueOnce(new Error('context_length_exceeded'))
        .mockResolvedValueOnce({
          text: 'success after truncation',
          usage: { inputTokens: 5, outputTokens: 3 },
        } as any)

      const client = new LLMClient({ provider: 'openai' })
      // With maxRetries=1, only 1 regular retry. Context truncation should NOT count.
      const memory = new Memory({ contextWindow: 0 }) // unlimited so toMessages() returns all
      memory.addSystem('sys').addUser('u1').addAssistant('a1').addUser('u2')

      const result = await client.generate(memory, { maxRetries: 1 })
      expect(result.content).toBe('success after truncation')
      // Called twice: once with full context (fails), once with truncated (succeeds)
      expect(vi.mocked(generateText)).toHaveBeenCalledTimes(2)
    })

    it('should throw when context cannot be truncated further on context error', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockRejectedValue(new Error('context_length_exceeded'))

      const client = new LLMClient({ provider: 'openai' })
      // Single user message — nothing to truncate
      const memory = new Memory()
      memory.addUser('single message')

      await expect(client.generate(memory, { maxRetries: 2 })).rejects.toThrow('context_length_exceeded')
    })

    it('should retry once on transient error and then succeed', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText)
        .mockRejectedValueOnce(new Error('temporary failure'))
        .mockResolvedValueOnce({
          text: 'success',
          usage: { inputTokens: 5, outputTokens: 3 },
        } as any)

      const client = new LLMClient({ provider: 'openai' })
      const memory = new Memory()
      memory.addUser('test')

      const result = await client.generate(memory, { maxRetries: 2 })
      expect(result.content).toBe('success')
      expect(vi.mocked(generateText)).toHaveBeenCalledTimes(2)
    })

    it('should forward headers from callOptions to generateText', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'response',
        usage: { inputTokens: 5, outputTokens: 3 },
      } as any)

      const client = new LLMClient({ provider: 'openai' })
      const memory = new Memory()
      memory.addUser('test')

      await client.generate(memory, { headers: { 'X-Custom': 'value' } })

      expect(vi.mocked(generateText)).toHaveBeenCalledWith(
        expect.objectContaining({ headers: { 'X-Custom': 'value' } }),
      )
    })

    it('should forward maxApiRetries from callOptions to generateText', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'response',
        usage: { inputTokens: 5, outputTokens: 3 },
      } as any)

      const client = new LLMClient({ provider: 'openai' })
      const memory = new Memory()
      memory.addUser('test')

      await client.generate(memory, { maxApiRetries: 5 })

      expect(vi.mocked(generateText)).toHaveBeenCalledWith(
        expect.objectContaining({ maxRetries: 5 }),
      )
    })

    it('should use callOptions.maxTokens over instance maxTokens in generate()', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'multi-turn response',
        usage: { inputTokens: 10, outputTokens: 5 },
      } as any)

      const client = new LLMClient({ provider: 'openai', maxTokens: 1024 })
      const memory = new Memory()
      memory.addUser('Hello')

      await client.generate(memory, { maxTokens: 32768 })

      expect(vi.mocked(generateText)).toHaveBeenCalledWith(
        expect.objectContaining({ maxOutputTokens: 32768 }),
      )
    })

    it('should accumulate usage stats across generate() calls', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText)
        .mockResolvedValueOnce({
          text: 'first',
          usage: { inputTokens: 10, outputTokens: 5 },
        } as any)
        .mockResolvedValueOnce({
          text: 'second',
          usage: { inputTokens: 20, outputTokens: 8 },
        } as any)

      const client = new LLMClient({ provider: 'openai' })
      const mem1 = new Memory()
      mem1.addUser('first')
      const mem2 = new Memory()
      mem2.addUser('second')

      await client.generate(mem1)
      await client.generate(mem2)

      const stats = client.getUsageStats()
      expect(stats.totalPromptTokens).toBe(30)
      expect(stats.totalCompletionTokens).toBe(13)
      expect(stats.requestCount).toBe(2)
    })
  })

  describe('generateJSON (multi-turn)', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should return structured output with schema', async () => {
      const { generateText } = await import('ai')

      const schema = z.object({ name: z.string(), count: z.number() })
      vi.mocked(generateText).mockResolvedValueOnce({
        output: { name: 'test', count: 3 },
        usage: { inputTokens: 10, outputTokens: 5 },
      } as any)

      const client = new LLMClient({ provider: 'openai' })
      const memory = new Memory()
      memory.addUser('extract entities')

      const result = await client.generateJSON(memory, schema)
      expect(result).toEqual({ name: 'test', count: 3 })
    })

    it('should pass messages (not prompt) to generateText for schema case', async () => {
      const { generateText } = await import('ai')

      const schema = z.object({ value: z.string() })
      vi.mocked(generateText).mockResolvedValueOnce({
        output: { value: 'ok' },
        usage: { inputTokens: 5, outputTokens: 3 },
      } as any)

      const client = new LLMClient({ provider: 'openai' })
      const memory = new Memory()
      memory.addUser('get value')

      await client.generateJSON(memory, schema)

      expect(vi.mocked(generateText)).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.any(Array),
        }),
      )
    })

    it('should throw when schema output is null', async () => {
      const { generateText } = await import('ai')

      const schema = z.object({ name: z.string() })
      vi.mocked(generateText).mockResolvedValueOnce({
        output: null,
        usage: { inputTokens: 5, outputTokens: 3 },
      } as any)

      const client = new LLMClient({ provider: 'openai' })
      const memory = new Memory()
      memory.addUser('extract')

      await expect(client.generateJSON(memory, schema))
        .rejects
        .toThrow('No structured output returned from model')
    })

    it('should extract JSON from code block when no schema provided', async () => {
      const { generateText } = await import('ai')

      vi.mocked(generateText).mockResolvedValueOnce({
        text: '```json\n{"result": 42}\n```',
        usage: { inputTokens: 5, outputTokens: 5 },
      } as any)

      const client = new LLMClient({ provider: 'openai' })
      const memory = new Memory()
      memory.addUser('compute')

      const result = await client.generateJSON<{ result: number }>(memory)
      expect(result).toEqual({ result: 42 })
    })

    it('should fall back to text parsing when NoObjectGeneratedError is thrown in generateJSON', async () => {
      const { generateText } = await import('ai')

      const schema = z.object({ count: z.number() })
      const fakeError = new MockNoObjectGeneratedError('No object generated', '{"count": 7}')
      vi.mocked(generateText).mockRejectedValueOnce(fakeError)

      const client = new LLMClient({ provider: 'openai' })
      const memory = new Memory()
      memory.addUser('count items')

      const result = await client.generateJSON(memory, schema)
      expect(result).toEqual({ count: 7 })
    })

    it('should throw structured error when NoObjectGeneratedError text fallback parse fails in generateJSON', async () => {
      const { generateText } = await import('ai')

      const schema = z.object({ count: z.number() })
      const fakeError = new MockNoObjectGeneratedError('No object generated', '{broken json}')
      vi.mocked(generateText).mockRejectedValueOnce(fakeError)

      const client = new LLMClient({ provider: 'openai' })
      const memory = new Memory()
      memory.addUser('count items')

      await expect(client.generateJSON(memory, schema))
        .rejects
        .toThrow('Structured output fallback parse failed (NoObjectGeneratedError → text → parse)')
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

    it('should estimate cost for claude-code sonnet model', () => {
      const client = new LLMClient({ provider: 'claude-code', model: 'sonnet' })
      const cost = client.estimateCost({
        totalPromptTokens: 1_000_000,
        totalCompletionTokens: 1_000_000,
        totalTokens: 2_000_000,
        requestCount: 5,
      })

      expect(cost.inputCost).toBe(3.00) // $3.00/M input
      expect(cost.outputCost).toBe(15.00) // $15.00/M output
      expect(cost.totalCost).toBe(18.00)
    })

    it('should estimate cost for claude-code opus model', () => {
      const client = new LLMClient({ provider: 'claude-code', model: 'opus' })
      const cost = client.estimateCost({
        totalPromptTokens: 1_000_000,
        totalCompletionTokens: 1_000_000,
        totalTokens: 2_000_000,
        requestCount: 1,
      })

      expect(cost.inputCost).toBe(15.00)
      expect(cost.outputCost).toBe(75.00)
      expect(cost.totalCost).toBe(90.00)
    })

    it('should estimate cost for claude-code haiku model', () => {
      const client = new LLMClient({ provider: 'claude-code', model: 'haiku' })
      const cost = client.estimateCost({
        totalPromptTokens: 1_000_000,
        totalCompletionTokens: 1_000_000,
        totalTokens: 2_000_000,
        requestCount: 1,
      })

      expect(cost.inputCost).toBe(1.00)
      expect(cost.outputCost).toBe(5.00)
      expect(cost.totalCost).toBe(6.00)
    })

    it('should estimate cost for codex gpt-5.3-codex model', () => {
      const client = new LLMClient({ provider: 'codex', model: 'gpt-5.3-codex' })
      const cost = client.estimateCost({
        totalPromptTokens: 1_000_000,
        totalCompletionTokens: 1_000_000,
        totalTokens: 2_000_000,
        requestCount: 1,
      })

      expect(cost.inputCost).toBe(1.25)
      expect(cost.outputCost).toBe(10.00)
      expect(cost.totalCost).toBe(11.25)
    })

    it('should estimate cost for gemini-cli gemini-2.5-flash model', () => {
      const client = new LLMClient({ provider: 'gemini-cli', model: 'gemini-2.5-flash' })
      const cost = client.estimateCost({
        totalPromptTokens: 1_000_000,
        totalCompletionTokens: 1_000_000,
        totalTokens: 2_000_000,
        requestCount: 1,
      })

      expect(cost.inputCost).toBe(0.15)
      expect(cost.outputCost).toBe(0.60)
      expect(cost.totalCost).toBe(0.75)
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
