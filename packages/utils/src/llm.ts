import type { ClaudeCodeSettings } from 'ai-sdk-provider-claude-code'
import type { ZodType } from 'zod/v4'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText, Output } from 'ai'
import { createClaudeCode } from 'ai-sdk-provider-claude-code'

/**
 * LLM provider type
 */
export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'claude-code'

/**
 * LLM client options
 */
export interface LLMOptions {
  /** Provider (openai, anthropic, google, or claude-code) */
  provider: LLMProvider
  /** API key (defaults to environment variable) */
  apiKey?: string
  /** Model name */
  model?: string
  /** Max tokens for response */
  maxTokens?: number
  /** Temperature for sampling */
  temperature?: number
  /** Timeout in milliseconds (default: 120000) */
  timeout?: number
  /** Error callback */
  onError?: (error: Error, context: { model: string, promptLength: number }) => void
  /** Claude Code provider settings (only used when provider is 'claude-code') */
  claudeCodeSettings?: ClaudeCodeSettings
}

export type { ClaudeCodeSettings }

/**
 * LLM response
 */
export interface LLMResponse {
  /** Generated text */
  content: string
  /** Token usage */
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  /** Model used */
  model: string
}

/**
 * Default models for each provider
 */
const DEFAULT_MODELS: Record<LLMProvider, string> = {
  'openai': 'gpt-4o',
  'anthropic': 'claude-sonnet-4.5',
  'google': 'gemini-3-flash-preview',
  'claude-code': 'sonnet',
}

/**
 * Pricing per million tokens (input, output) in USD
 */
const CLAUDE_SONNET_PRICING = { input: 3.00, output: 15.00 }
const CLAUDE_HAIKU_PRICING = { input: 1.00, output: 5.00 }

const MODEL_PRICING: Record<string, { input: number, output: number }> = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-5': { input: 1.25, output: 10.00 },
  'gpt-5-mini': { input: 0.25, output: 2.00 },
  'claude-sonnet-4.5': CLAUDE_SONNET_PRICING,
  'claude-haiku-4.5': CLAUDE_HAIKU_PRICING,
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  'gemini-3-pro-preview': { input: 2.00, output: 12.00 },
  'gemini-2.0-flash': { input: 0.30, output: 2.50 },
  // Claude Code provider uses model shortcuts (sonnet/opus/haiku).
  // Pricing reflects equivalent Claude API rates for cost estimation,
  // not actual charges (Claude Code uses subscription billing).
  'sonnet': CLAUDE_SONNET_PRICING,
  'opus': { input: 15.00, output: 75.00 },
  'haiku': CLAUDE_HAIKU_PRICING,
}

/**
 * Create provider instance
 */
function createProvider(provider: LLMProvider, apiKey?: string, claudeCodeSettings?: ClaudeCodeSettings) {
  switch (provider) {
    case 'openai':
      return createOpenAI({
        apiKey: apiKey ?? process.env.OPENAI_API_KEY,
      })
    case 'anthropic':
      return createAnthropic({
        apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
      })
    case 'google':
      return createGoogleGenerativeAI({
        apiKey: apiKey ?? process.env.GOOGLE_API_KEY,
      })
    case 'claude-code':
      return createClaudeCode(claudeCodeSettings ? { defaultSettings: claudeCodeSettings } : undefined)
    default:
      throw new Error(`Unsupported LLM provider: ${String(provider satisfies never)}`)
  }
}

/**
 * Cumulative token usage statistics
 */
export interface TokenUsageStats {
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  requestCount: number
}

const INITIAL_USAGE_STATS: TokenUsageStats = {
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalTokens: 0,
  requestCount: 0,
}

/**
 * Parse a "provider/model" format string into provider and model components.
 *
 * @example
 * parseModelString('openai/gpt-5.2') // { provider: 'openai', model: 'gpt-5.2' }
 * parseModelString('claude-code/haiku') // { provider: 'claude-code', model: 'haiku' }
 * parseModelString('google') // { provider: 'google', model: undefined }
 */
export function parseModelString(modelString: string): { provider: LLMProvider, model?: string } {
  const slashIndex = modelString.indexOf('/')
  if (slashIndex === -1) {
    return { provider: validateProvider(modelString) }
  }
  const provider = validateProvider(modelString.substring(0, slashIndex))
  const model = modelString.substring(slashIndex + 1)
  return { provider, model: model || undefined }
}

function validateProvider(name: string): LLMProvider {
  const valid = Object.keys(DEFAULT_MODELS) as LLMProvider[]
  if (!valid.includes(name as LLMProvider)) {
    throw new Error(`Unknown LLM provider: "${name}". Valid providers: ${valid.join(', ')}`)
  }
  return name as LLMProvider
}

/**
 * LLM Client for semantic operations using Vercel AI SDK
 *
 * Used for:
 * - Semantic feature extraction
 * - Functional hierarchy construction
 * - Code generation
 *
 * Supports OpenAI, Anthropic, Google, and Claude Code providers with unified interface.
 *
 * @example
 * ```typescript
 * // Use Gemini 3 Flash (recommended - free tier, best performance)
 * const client = new LLMClient({ provider: 'google', model: 'gemini-2.0-flash' })
 *
 * // Use Claude Haiku (fast, cost-effective)
 * const client = new LLMClient({ provider: 'anthropic', model: 'claude-3-5-haiku-latest' })
 *
 * // Use GPT-4o (paper baseline)
 * const client = new LLMClient({ provider: 'openai', model: 'gpt-4o' })
 *
 * // Use Claude Code (no API key needed, requires Claude Pro/Max subscription)
 * const client = new LLMClient({ provider: 'claude-code', model: 'sonnet' })
 * ```
 */
export class LLMClient {
  private readonly options: LLMOptions
  private readonly providerInstance: ReturnType<typeof createProvider>
  private usageStats: TokenUsageStats = { ...INITIAL_USAGE_STATS }

  constructor(options: LLMOptions) {
    this.options = {
      model: DEFAULT_MODELS[options.provider],
      maxTokens: 4096,
      temperature: 0,
      ...options,
    }
    this.providerInstance = createProvider(options.provider, options.apiKey, options.claudeCodeSettings)
  }

  /**
   * Shared helper for generateText calls with error handling and usage tracking.
   */
  private async callGenerateText(
    prompt: string,
    systemPrompt?: string,
    output?: Parameters<typeof generateText>[0]['output'],
  ): Promise<Awaited<ReturnType<typeof generateText>>> {
    const modelId = this.options.model ?? DEFAULT_MODELS[this.options.provider]
    const model = this.providerInstance(modelId)
    const timeout = this.options.timeout ?? 120_000

    let result: Awaited<ReturnType<typeof generateText>>
    try {
      result = await generateText({
        model,
        output,
        system: systemPrompt,
        prompt,
        maxOutputTokens: this.options.maxTokens,
        temperature: this.options.temperature,
        abortSignal: AbortSignal.timeout(timeout),
      })
    }
    catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      console.error(`[LLMClient] ${modelId} error: ${err.message}`)
      this.options.onError?.(err, { model: modelId, promptLength: prompt.length })
      throw err
    }

    const inputTokens = result.usage?.inputTokens ?? 0
    const outputTokens = result.usage?.outputTokens ?? 0
    this.usageStats.totalPromptTokens += inputTokens
    this.usageStats.totalCompletionTokens += outputTokens
    this.usageStats.totalTokens += inputTokens + outputTokens
    this.usageStats.requestCount++

    return result
  }

  /**
   * Generate a completion using Vercel AI SDK
   */
  async complete(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    const result = await this.callGenerateText(prompt, systemPrompt)
    const modelId = this.options.model ?? DEFAULT_MODELS[this.options.provider]

    return {
      content: result.text,
      usage: {
        promptTokens: result.usage?.inputTokens ?? 0,
        completionTokens: result.usage?.outputTokens ?? 0,
        totalTokens: (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0),
      },
      model: modelId,
    }
  }

  /**
   * Generate structured JSON output.
   * When a Zod schema is provided, uses AI SDK's Output.object() for validated structured output.
   * Falls back to regex-based JSON extraction when no schema is given.
   */
  async completeJSON<T>(prompt: string, systemPrompt?: string, schema?: ZodType<T>): Promise<T> {
    if (schema) {
      const result = await this.callGenerateText(prompt, systemPrompt, Output.object({ schema }))

      if (result.output == null) {
        throw new Error('No structured output returned from model')
      }

      return result.output as T
    }

    // Fallback: regex-based JSON extraction for callers without schema
    const response = await this.complete(prompt, systemPrompt)
    const jsonMatch
      = response.content.match(/```(?:json)?\n?([\s\S]*?)```/)
        || response.content.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      throw new Error('No JSON found in response')
    }

    return JSON.parse(jsonMatch[1] ?? jsonMatch[0]) as T
  }

  /**
   * Get the current provider
   */
  getProvider(): LLMProvider {
    return this.options.provider
  }

  /**
   * Get the current model
   */
  getModel(): string {
    return this.options.model ?? DEFAULT_MODELS[this.options.provider]
  }

  /**
   * Get cumulative token usage statistics
   */
  getUsageStats(): TokenUsageStats {
    return { ...this.usageStats }
  }

  /**
   * Estimate cost in USD based on token usage and model pricing
   */
  estimateCost(stats?: TokenUsageStats): { inputCost: number, outputCost: number, totalCost: number } {
    const s = stats ?? this.usageStats
    const modelId = this.getModel()
    const pricing = MODEL_PRICING[modelId]
    if (!pricing) {
      return { inputCost: 0, outputCost: 0, totalCost: 0 }
    }
    const inputCost = (s.totalPromptTokens / 1_000_000) * pricing.input
    const outputCost = (s.totalCompletionTokens / 1_000_000) * pricing.output
    return { inputCost, outputCost, totalCost: inputCost + outputCost }
  }

  /**
   * Reset usage statistics
   */
  resetUsageStats(): void {
    this.usageStats = { ...INITIAL_USAGE_STATS }
  }
}
