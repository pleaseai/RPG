/**
 * LLM provider type
 */
export type LLMProvider = 'openai' | 'anthropic'

/**
 * LLM client options
 */
export interface LLMOptions {
  /** Provider (openai or anthropic) */
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
 * LLM Client for semantic operations
 *
 * Used for:
 * - Semantic feature extraction
 * - Functional hierarchy construction
 * - Code generation
 */
export class LLMClient {
  private options: LLMOptions

  constructor(options: LLMOptions) {
    this.options = {
      model: options.provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o',
      maxTokens: 4096,
      temperature: 0,
      ...options,
    }
  }

  /**
   * Generate a completion
   */
  async complete(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    if (this.options.provider === 'anthropic') {
      return this.completeAnthropic(prompt, systemPrompt)
    }
    return this.completeOpenAI(prompt, systemPrompt)
  }

  /**
   * Generate structured JSON output
   */
  async completeJSON<T>(prompt: string, systemPrompt?: string): Promise<T> {
    const response = await this.complete(prompt, systemPrompt)
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch =
      response.content.match(/```(?:json)?\s*([\s\S]*?)```/) ||
      response.content.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      throw new Error('No JSON found in response')
    }

    return JSON.parse(jsonMatch[1] ?? jsonMatch[0]) as T
  }

  private async completeAnthropic(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    const Anthropic = await import('@anthropic-ai/sdk')
    const client = new Anthropic.default({
      apiKey: this.options.apiKey ?? process.env.ANTHROPIC_API_KEY,
    })

    const response = await client.messages.create({
      model: this.options.model ?? 'claude-sonnet-4-20250514',
      max_tokens: this.options.maxTokens ?? 4096,
      temperature: this.options.temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    })

    const textBlock = response.content.find((b) => b.type === 'text')
    return {
      content: textBlock?.type === 'text' ? textBlock.text : '',
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      model: response.model,
    }
  }

  private async completeOpenAI(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    const OpenAI = await import('openai')
    const client = new OpenAI.default({
      apiKey: this.options.apiKey ?? process.env.OPENAI_API_KEY,
    })

    const messages: Array<{ role: 'system' | 'user'; content: string }> = []
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }
    messages.push({ role: 'user', content: prompt })

    const response = await client.chat.completions.create({
      model: this.options.model ?? 'gpt-4o',
      max_tokens: this.options.maxTokens,
      temperature: this.options.temperature,
      messages,
    })

    return {
      content: response.choices[0]?.message?.content ?? '',
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
      model: response.model,
    }
  }
}
