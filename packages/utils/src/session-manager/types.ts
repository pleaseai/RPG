import type { GoogleLanguageModelOptions } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'
import type { ClaudeCodeSettings } from 'ai-sdk-provider-claude-code'
import type { CodexCliSettings } from 'ai-sdk-provider-codex-cli'
import type { GeminiProviderOptions } from 'ai-sdk-provider-gemini-cli'

export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'claude-code' | 'codex' | 'gemini-cli'

/**
 * Subset of LLMOptions required to construct a SessionManager.
 * Re-exported from `./llm` to avoid a circular dependency.
 */
export interface SessionManagerOptions {
  provider: LLMProvider
  apiKey?: string
  claudeCodeSettings?: ClaudeCodeSettings
  codexSettings?: CodexCliSettings
  geminiCliSettings?: GeminiProviderOptions
  googleSettings?: GoogleLanguageModelOptions
}

/**
 * A SessionManager owns the AI-SDK provider factory for one LLMProvider.
 * Each subclass encapsulates provider-specific construction (env vars,
 * default settings, subprocess spawn overrides).
 *
 * Future hooks (`beforeCall` / `afterCall`) will be added here when
 * session-trace capture lands — keeping the interface forward-compatible.
 */
/** AI-SDK provider factory shape, e.g. the return type of `createOpenAI()`. */
export type LanguageModelFactory = (modelId: string) => LanguageModel

export interface SessionManager {
  /** AI-SDK provider factory: `(modelId) => LanguageModel`. */
  createProvider: () => LanguageModelFactory
}
