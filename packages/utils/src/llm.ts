import type { GoogleLanguageModelOptions } from '@ai-sdk/google'
import type { LanguageModel, ModelMessage } from 'ai'
import type { ClaudeCodeSettings } from 'ai-sdk-provider-claude-code'
import type { CodexCliSettings } from 'ai-sdk-provider-codex-cli'
import type { GeminiProviderOptions } from 'ai-sdk-provider-gemini-cli'
import type { ZodType } from 'zod/v4'
import type { Memory } from './memory'
import type { LanguageModelFactory, LLMProvider, SessionManager } from './session-manager'
import { APICallError, generateText, NoObjectGeneratedError, Output } from 'ai'
import { LLMCallLog } from './llm-call-log'
import { createLogger } from './logger'
import { createSessionManager } from './session-manager'

type GenerateTextParams = Parameters<typeof generateText>[0]

const log = createLogger('LLMClient')

export type { LLMProvider }

/**
 * LLM client options
 */
export interface LLMOptions {
  /** Provider (openai, anthropic, google, claude-code, codex, or gemini-cli) */
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
  /** Codex CLI provider settings (only used when provider is 'codex') */
  codexSettings?: CodexCliSettings
  /** Gemini CLI provider settings (only used when provider is 'gemini-cli') */
  geminiCliSettings?: GeminiProviderOptions
  /** Google provider settings (only used when provider is 'google') */
  googleSettings?: GoogleLanguageModelOptions
  /**
   * Directory where per-call session traces are persisted (currently used by
   * the claude-code provider to copy `~/.claude/projects/<encoded>/<uuid>.jsonl`).
   * When unset, trace capture is off.
   */
  sessionTraceDir?: string
  /**
   * Path to the per-call audit-log SQLite database. When unset, no log is
   * written. Typically `.soop/cache/llm-call-log.db`.
   */
  callLogPath?: string
}

export type { GoogleLanguageModelOptions }

export type { ClaudeCodeSettings }
export type { CodexCliSettings }
export type { GeminiProviderOptions }

/**
 * Per-call options that override the LLMClient instance-level settings.
 */
export interface CallOptions {
  /**
   * Provider-specific options passed directly to the AI SDK's `generateText` call.
   * Supports any provider (google, anthropic, openai, etc.).
   * Passing options for a non-active provider is safe — the AI SDK ignores unknown keys.
   *
   * @example
   * // Google: control thinking level per phase
   * { google: { thinkingConfig: { thinkingLevel: 'minimal' } } satisfies GoogleLanguageModelOptions }
   *
   * // Anthropic: enable extended thinking
   * { anthropic: { thinking: { type: 'enabled', budgetTokens: 5000 } } }
   *
   * // OpenAI: disable parallel tool calls
   * { openai: { parallelToolCalls: false } }
   */
  providerOptions?: Parameters<typeof generateText>[0]['providerOptions']
  /** Additional HTTP headers sent with the request. Only applicable for HTTP-based providers. */
  headers?: Parameters<typeof generateText>[0]['headers']
  /** Override timeout in milliseconds for this call. */
  timeout?: number
  /** Override max output tokens for this call. */
  maxTokens?: number
  /** Maximum number of AI SDK-level retries on API failure. Default: 2. */
  maxApiRetries?: number
  /**
   * Schema name hint passed to Output.object() — helps some providers generate better structured output.
   * Only used when a schema is passed to completeJSON() / generateJSON().
   */
  schemaName?: string
  /**
   * Schema description hint passed to Output.object() — additional LLM guidance for structured output.
   * Only used when a schema is passed to completeJSON() / generateJSON().
   */
  schemaDescription?: string
  /**
   * Free-form tag describing what this call is for (e.g., `semantic-parse`).
   * Surfaces in session-trace filenames and (future) call-log rows.
   */
  purpose?: string
}

/**
 * Options for multi-turn `generate()` calls.
 */
export interface GenerateOptions extends CallOptions {
  /** Maximum number of attempts on transient errors with context truncation. Default: 3. */
  maxRetries?: number
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
  'openai': 'gpt-4o',
  'anthropic': 'claude-sonnet-4.5',
  'google': 'gemini-3.1-flash-lite-preview',
  'claude-code': 'sonnet',
  'codex': 'gpt-5.3-codex',
  'gemini-cli': 'gemini-2.5-flash',
}

/**
 * Pricing per million tokens (input, output) in USD
 */
const CLAUDE_SONNET_PRICING = { input: 3.00, output: 15.00 }
const CLAUDE_HAIKU_PRICING = { input: 1.00, output: 5.00 }
const CODEX_GPT5_PRICING = { input: 1.25, output: 10.00 }

const MODEL_PRICING: Record<string, { input: number, output: number }> = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-5': { input: 1.25, output: 10.00 },
  'gpt-5-mini': { input: 0.25, output: 2.00 },
  'claude-sonnet-4.5': CLAUDE_SONNET_PRICING,
  'claude-haiku-4.5': CLAUDE_HAIKU_PRICING,
  'gemini-3.1-flash-lite-preview': { input: 0.25, output: 1.50 },
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  'gemini-3-pro-preview': { input: 2.00, output: 12.00 },
  'gemini-2.0-flash': { input: 0.30, output: 2.50 },
  // Claude Code provider uses model shortcuts (sonnet/opus/haiku).
  // Pricing reflects equivalent Claude API rates for cost estimation,
  // not actual charges (Claude Code uses subscription billing).
  'sonnet': CLAUDE_SONNET_PRICING,
  'opus': { input: 15.00, output: 75.00 },
  'haiku': CLAUDE_HAIKU_PRICING,
  // Codex CLI provider uses ChatGPT Plus/Pro subscription.
  // Pricing reflects equivalent OpenAI API rates for cost estimation,
  // not actual charges (Codex CLI uses subscription billing).
  'gpt-5.3-codex': CODEX_GPT5_PRICING,
  'gpt-5.2-codex': CODEX_GPT5_PRICING,
  'gpt-5.1-codex-max': CODEX_GPT5_PRICING,
  // Gemini CLI uses OAuth/free-tier credentials.
  // Pricing reflects equivalent Google API rates for cost estimation.
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.5-pro': { input: 1.25, output: 10.00 },
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
 * Detect context-length errors from various LLM providers.
 */
function isContextLengthError(error: unknown): boolean {
  if (!(error instanceof Error))
    return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes('context_length_exceeded')
    || msg.includes('context length')
    || msg.includes('too many tokens')
    || msg.includes('token limit')
    || msg.includes('maximum context')
  )
}

/**
 * LLM Client for semantic operations using Vercel AI SDK
 *
 * Used for:
 * - Semantic feature extraction
 * - Functional hierarchy construction
 * - Code generation
 *
 * Supports OpenAI, Anthropic, Google, Claude Code, Codex CLI, and Gemini CLI providers with unified interface.
 *
 * @example
 * ```typescript
 * // Use Gemini 3.1 Flash-Lite (recommended - best performance/cost)
 * const client = new LLMClient({ provider: 'google', model: 'gemini-3.1-flash-lite-preview' })
 *
 * // Use Claude Haiku (fast, cost-effective)
 * const client = new LLMClient({ provider: 'anthropic', model: 'claude-haiku-4.5' })
 *
 * // Use GPT-4o (paper baseline)
 * const client = new LLMClient({ provider: 'openai', model: 'gpt-4o' })
 *
 * // Use Claude Code (no API key needed, requires Claude Pro/Max subscription)
 * const client = new LLMClient({ provider: 'claude-code', model: 'sonnet' })
 *
 * // Use Codex CLI (no API key needed, requires ChatGPT Plus/Pro subscription)
 * const client = new LLMClient({ provider: 'codex', model: 'gpt-5.3-codex' })
 *
 * // Use Gemini CLI (no API key needed, uses OAuth from `gemini` CLI login)
 * const client = new LLMClient({ provider: 'gemini-cli', model: 'gemini-2.5-flash' })
 * ```
 */
/** True when the AI SDK signals the error is safe to retry. */
function isRetryableError(err: unknown): boolean {
  return APICallError.isInstance(err) && err.isRetryable === true
}

export class LLMClient {
  private readonly options: LLMOptions
  private readonly sessionManager: SessionManager
  private readonly providerInstance: LanguageModelFactory
  private readonly callLog: LLMCallLog | null
  private usageStats: TokenUsageStats = { ...INITIAL_USAGE_STATS }

  constructor(options: LLMOptions) {
    this.options = {
      model: DEFAULT_MODELS[options.provider],
      maxTokens: 32768,
      temperature: 0,
      ...options,
    }
    if (options.googleSettings && options.provider !== 'google') {
      log.warn(
        `'googleSettings' was provided for a non-Google provider ('${options.provider}'). These settings will be ignored.`,
      )
    }
    this.sessionManager = createSessionManager(options)
    this.providerInstance = this.sessionManager.createProvider()
    this.callLog = options.callLogPath
      ? new LLMCallLog({ dbPath: options.callLogPath })
      : null
  }

  /**
   * Persist an audit record for the most recent call.
   * Errors during logging are swallowed (best-effort observability).
   */
  private async recordCall(
    input: { provider: LLMProvider, model: string, purpose: string, prompt: string, response?: string, durationMs: number, retries: number, error?: string },
  ): Promise<void> {
    if (!this.callLog) {
      return
    }
    try {
      await this.callLog.record({
        provider: input.provider,
        model: input.model,
        purpose: input.purpose,
        prompt: input.prompt,
        response: input.response,
        durationMs: input.durationMs,
        retries: input.retries,
        error: input.error,
      })
    }
    catch (err) {
      log.warn(`Failed to record LLM call: ${(err as Error).message}`)
    }
  }

  private buildProviderOptions(callOptions?: CallOptions): Parameters<typeof generateText>[0]['providerOptions'] {
    // Per-call providerOptions take precedence over instance-level googleSettings.
    if (callOptions?.providerOptions !== undefined) {
      return callOptions.providerOptions
    }
    if (this.options.provider === 'google' && this.options.googleSettings && Object.keys(this.options.googleSettings).length > 0) {
      return { google: this.options.googleSettings } as unknown as Parameters<typeof generateText>[0]['providerOptions']
    }
    return undefined
  }

  /**
   * Drive a single `generateText` invocation with the retry loop,
   * session-trace capture, audit logging, and usage tracking required
   * by every public path on this class.
   *
   * For providers whose SessionManager exposes `beginCall()` (currently
   * claude-code), this regenerates the session UUID on each retryable
   * failure; for other providers, AI-SDK internal retry handles it.
   */
  private async runWithSession(args: {
    callOptions: CallOptions | undefined
    buildParams: (model: LanguageModel) => GenerateTextParams
    promptForLog: string
    promptLengthForOnError: number
  }): Promise<Awaited<ReturnType<typeof generateText>>> {
    const { callOptions, buildParams, promptForLog, promptLengthForOnError } = args
    const modelId = this.options.model ?? DEFAULT_MODELS[this.options.provider]
    const purpose = callOptions?.purpose ?? 'general'

    const callSession = this.sessionManager.beginCall?.(modelId, purpose)
    const maxAttempts = callSession ? (callOptions?.maxApiRetries ?? 2) + 1 : 1
    const aiSdkMaxRetries = callSession?.disableAiSdkRetry ? 0 : callOptions?.maxApiRetries

    let lastError: Error | undefined
    let result: Awaited<ReturnType<typeof generateText>> | undefined
    let retries = 0
    const startedAt = Date.now()

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const model = callSession ? callSession.model : this.providerInstance(modelId)
      try {
        result = await generateText({
          ...buildParams(model),
          maxRetries: aiSdkMaxRetries,
        })
        lastError = undefined
        break
      }
      catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        lastError = err
        if (!callSession || !isRetryableError(err) || attempt === maxAttempts - 1) {
          break
        }
        log.debug(`${modelId} attempt ${attempt + 1} failed (${err.message}); regenerating session and retrying`)
        retries++
        callSession.regenerate()
      }
    }

    if (callSession) {
      await callSession.finalize({ success: result !== undefined }).catch((err: unknown) => {
        log.warn(`Session finalize failed: ${(err as Error).message}`)
      })
    }

    const durationMs = Date.now() - startedAt

    if (!result) {
      const err = lastError ?? new Error('generateText returned no result')
      await this.recordCall({
        provider: this.options.provider,
        model: modelId,
        purpose,
        prompt: promptForLog,
        durationMs,
        retries,
        error: err.message,
      })
      log.error(`${modelId} error: ${err.message}`, err)
      this.options.onError?.(err, { model: modelId, promptLength: promptLengthForOnError })
      throw err
    }

    await this.recordCall({
      provider: this.options.provider,
      model: modelId,
      purpose,
      prompt: promptForLog,
      response: result.text,
      durationMs,
      retries,
    })

    const inputTokens = result.usage?.inputTokens ?? 0
    const outputTokens = result.usage?.outputTokens ?? 0
    this.usageStats.totalPromptTokens += inputTokens
    this.usageStats.totalCompletionTokens += outputTokens
    this.usageStats.totalTokens += inputTokens + outputTokens
    this.usageStats.requestCount++

    return result
  }

  private async callGenerateText(
    prompt: string,
    systemPrompt?: string,
    output?: GenerateTextParams['output'],
    callOptions?: CallOptions,
  ): Promise<Awaited<ReturnType<typeof generateText>>> {
    const timeout = callOptions?.timeout ?? this.options.timeout ?? 120_000
    const maxOutputTokens = callOptions?.maxTokens ?? this.options.maxTokens

    return this.runWithSession({
      callOptions,
      buildParams: model => ({
        model,
        output,
        system: systemPrompt,
        prompt,
        maxOutputTokens,
        temperature: this.options.temperature,
        abortSignal: AbortSignal.timeout(timeout),
        providerOptions: this.buildProviderOptions(callOptions),
        headers: callOptions?.headers,
      }),
      promptForLog: prompt,
      promptLengthForOnError: prompt.length,
    })
  }

  /**
   * Generate a completion using Vercel AI SDK
   */
  async complete(prompt: string, systemPrompt?: string, callOptions?: CallOptions): Promise<LLMResponse> {
    const result = await this.callGenerateText(prompt, systemPrompt, undefined, callOptions)
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
  async completeJSON<T>(prompt: string, systemPrompt?: string, schema?: ZodType<T>, callOptions?: CallOptions): Promise<T> {
    if (schema) {
      let rawText: string | undefined
      try {
        const result = await this.callGenerateText(
          prompt,
          systemPrompt,
          Output.object({ schema, name: callOptions?.schemaName, description: callOptions?.schemaDescription }),
          callOptions,
        )

        if (result.output != null) {
          return result.output as T
        }

        // Structured output failed (non-'stop' finishReason from provider).
        const lastStep = result.steps.at(-1)
        const finishReason = lastStep?.finishReason ?? 'unknown'
        log.debug(`Structured output unavailable (finishReason: ${finishReason}), trying text fallback`)
        rawText = result.text
      }
      catch (error) {
        // NoObjectGeneratedError carries the raw text the model produced — use it for fallback.
        if (NoObjectGeneratedError.isInstance(error)) {
          log.warn(`Structured output not generated (NoObjectGeneratedError): ${error.message} — attempting text fallback`)
          rawText = error.text
        }
        else {
          throw error
        }
      }

      if (rawText) {
        const jsonMatch
          = rawText.match(/```(?:json)?\n?([\s\S]*?)```/) || rawText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[1] ?? jsonMatch[0])
            return schema.parse(parsed) as T
          }
          catch (parseError) {
            const msg = parseError instanceof Error ? parseError.message : String(parseError)
            throw new Error(`Structured output fallback parse failed (NoObjectGeneratedError → text → parse): ${msg}`, { cause: parseError })
          }
        }
      }
      throw new Error('No structured output returned from model')
    }

    // Fallback: regex-based JSON extraction for callers without schema
    const response = await this.complete(prompt, systemPrompt, callOptions)
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

  /**
   * Shared helper for generateText calls using a messages array (multi-turn).
   * Mirrors `callGenerateText` but uses `{ messages }` instead of `{ prompt, system }`.
   */
  private async callGenerateTextWithMessages(
    messages: ModelMessage[],
    output?: GenerateTextParams['output'],
    callOptions?: CallOptions,
  ): Promise<Awaited<ReturnType<typeof generateText>>> {
    const timeout = callOptions?.timeout ?? this.options.timeout ?? 120_000
    const maxOutputTokens = callOptions?.maxTokens ?? this.options.maxTokens
    const flatContent = messages.map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))

    return this.runWithSession({
      callOptions,
      buildParams: model => ({
        model,
        output,
        messages,
        maxOutputTokens,
        temperature: this.options.temperature,
        abortSignal: AbortSignal.timeout(timeout),
        providerOptions: this.buildProviderOptions(callOptions),
        headers: callOptions?.headers,
      }),
      promptForLog: flatContent.join('\n'),
      promptLengthForOnError: flatContent.reduce((sum, c) => sum + c.length, 0),
    })
  }

  /**
   * Multi-turn completion using a `Memory` conversation history.
   *
   * Retries on transient errors (up to `maxRetries` total attempts).
   * On context-length errors, truncates the oldest user-assistant pair and
   * retries without consuming a retry count.
   */
  async generate(memory: Memory, options?: GenerateOptions): Promise<LLMResponse> {
    const maxRetries = options?.maxRetries ?? 3
    let messages = memory.toMessages()
    let retries = 0

    while (true) {
      try {
        const result = await this.callGenerateTextWithMessages(messages, undefined, options)
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
      catch (error) {
        if (isContextLengthError(error)) {
          const truncated = this.truncateContext(messages)
          if (truncated !== null) {
            messages = truncated
            continue
          }
        }
        retries++
        if (retries >= maxRetries) {
          throw error
        }
        const msg = error instanceof Error ? error.message : String(error)
        log.warn(`generate() retry ${retries}/${maxRetries} after error: ${msg}`)
      }
    }
  }

  /**
   * Multi-turn structured JSON output using a `Memory` conversation history.
   * When a Zod schema is provided, uses AI SDK's `Output.object()` for validated output.
   * Falls back to regex-based JSON extraction when no schema is given.
   */
  async generateJSON<T>(memory: Memory, schema?: ZodType<T>, callOptions?: CallOptions): Promise<T> {
    if (schema) {
      const messages = memory.toMessages()
      let rawText: string | undefined
      try {
        const result = await this.callGenerateTextWithMessages(
          messages,
          Output.object({ schema, name: callOptions?.schemaName, description: callOptions?.schemaDescription }),
          callOptions,
        )

        if (result.output != null) {
          return result.output as T
        }

        rawText = result.text
      }
      catch (error) {
        if (NoObjectGeneratedError.isInstance(error)) {
          log.warn(`Structured output not generated (NoObjectGeneratedError): ${error.message} — attempting text fallback`)
          rawText = error.text
        }
        else {
          throw error
        }
      }

      if (rawText) {
        const jsonMatch
          = rawText.match(/```(?:json)?\n?([\s\S]*?)```/) || rawText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[1] ?? jsonMatch[0])
            return (schema as ZodType<T>).parse(parsed) as T
          }
          catch (parseError) {
            const msg = parseError instanceof Error ? parseError.message : String(parseError)
            throw new Error(`Structured output fallback parse failed (NoObjectGeneratedError → text → parse): ${msg}`, { cause: parseError })
          }
        }
      }
      throw new Error('No structured output returned from model')
    }

    const response = await this.generate(memory, callOptions)
    const jsonMatch
      = response.content.match(/```(?:json)?\n?([\s\S]*?)```/)
        || response.content.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      throw new Error('No JSON found in response')
    }

    return JSON.parse(jsonMatch[1] ?? jsonMatch[0]) as T
  }

  /**
   * Remove the oldest user-assistant pair from the message list.
   * Returns the trimmed list, or `null` if there is nothing to remove.
   */
  private truncateContext(messages: ModelMessage[]): ModelMessage[] | null {
    const hasSystem = messages.length > 0 && messages[0]!.role === 'system'
    const startIndex = hasSystem ? 1 : 0

    for (let i = startIndex; i < messages.length - 1; i++) {
      if (messages[i]!.role === 'user' && messages[i + 1]!.role === 'assistant') {
        return [...messages.slice(0, i), ...messages.slice(i + 2)]
      }
    }

    return null
  }
}
