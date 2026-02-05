import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'

/**
 * LLM provider type
 */
export type LLMProvider = 'openai' | 'anthropic' | 'google'

/**
 * LLM client options
 */
export interface LLMOptions {
  /** Provider (openai, anthropic, or google) */
  provider: LLMProvider
  /** API key (defaults to environment variable) */
  apiKey?: string
  /** Model name */
  model?: string
  /** Max tokens for response */
  maxTokens?: number
  /** Temperature for sampling */
  temperature?: number
}

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
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  google: 'gemini-2.0-flash',
}

/**
 * Create provider instance
 */
function createProvider(provider: LLMProvider, apiKey?: string) {
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
  }
}

/**
 * LLM Client for semantic operations using Vercel AI SDK
 *
 * Used for:
 * - Semantic feature extraction
 * - Functional hierarchy construction
 * - Code generation
 *
 * Supports OpenAI, Anthropic, and Google providers with unified interface.
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
 * ```
 */
export class LLMClient {
  private options: LLMOptions
  private providerInstance: ReturnType<typeof createProvider>

  constructor(options: LLMOptions) {
    this.options = {
      model: DEFAULT_MODELS[options.provider],
      maxTokens: 4096,
      temperature: 0,
      ...options,
    }
    this.providerInstance = createProvider(options.provider, options.apiKey)
  }

  /**
   * Generate a completion using Vercel AI SDK
   */
  async complete(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    const modelId = this.options.model ?? DEFAULT_MODELS[this.options.provider]
    const model = this.providerInstance(modelId)

    const result = await generateText({
      model,
      system: systemPrompt,
      prompt,
      maxOutputTokens: this.options.maxTokens,
      temperature: this.options.temperature,
    })

    const inputTokens = result.usage?.inputTokens ?? 0
    const outputTokens = result.usage?.outputTokens ?? 0

    return {
      content: result.text,
      usage: {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      model: modelId,
    }
  }

  /**
   * Generate structured JSON output
   */
  async completeJSON<T>(prompt: string, systemPrompt?: string): Promise<T> {
    const response = await this.complete(prompt, systemPrompt)
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch
      = response.content.match(/```(?:json)?\s*([\s\S]*?)```/)
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
}
