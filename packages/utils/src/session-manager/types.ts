import type { GoogleLanguageModelOptions } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'
import type { ClaudeCodeSettings } from 'ai-sdk-provider-claude-code'
import type { CodexCliSettings } from 'ai-sdk-provider-codex-cli'
import type { GeminiProviderOptions } from 'ai-sdk-provider-gemini-cli'

/**
 * Per-call session context returned by `SessionManager.beginCall()`.
 * Lets CLI-based providers (claude-code) inject a fresh session ID per
 * attempt and capture the resulting JSONL trace after the call completes.
 */
export interface CallSession {
  /** Fresh AI-SDK language model for this attempt. */
  model: LanguageModel
  /**
   * If true, the LLMClient must pass `maxRetries: 0` to `generateText()`
   * and handle retries itself by calling `regenerate()` between attempts.
   */
  disableAiSdkRetry: boolean
  /**
   * Replace `model` with a new instance suitable for a retry attempt
   * (e.g., a new `sessionId` UUID for claude-code).
   */
  regenerate: () => void
  /**
   * Called once per call (after either a successful result or the
   * final failed attempt). Captures any side-artifacts such as the
   * Claude session JSONL.
   */
  finalize: (outcome: { success: boolean }) => Promise<void>
}

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
  /**
   * Directory where claude-code session JSONL traces are copied after each
   * call (e.g. `.soop/cache/sessions/`). When unset, trace capture is off.
   */
  sessionTraceDir?: string
  /**
   * Override `~/.claude/projects/` discovery (test seam).
   */
  claudeProjectsRoot?: string
  /**
   * Workspace cwd used to encode the Claude project-directory name
   * (`/Users/…/foo_bar` → `-Users-…-foo-bar`). Defaults to `process.cwd()`.
   */
  workspaceCwd?: string
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
  /**
   * Optional per-call hook. When defined, the LLMClient must use the
   * returned `CallSession` for this attempt (retry loop included) instead
   * of reusing a constructor-time provider. CLI-based providers
   * (claude-code) need this so they can rotate their session UUID.
   */
  beginCall?: (modelId: string, purpose: string) => CallSession
}
