import type { SessionManager, SessionManagerOptions } from './types'
import { AnthropicSessionManager } from './anthropic'
import { ClaudeCodeSessionManager } from './claude-code'
import { CodexSessionManager } from './codex'
import { GeminiCliSessionManager } from './gemini-cli'
import { GoogleSessionManager } from './google'
import { OpenAISessionManager } from './openai'

export type { LanguageModelFactory, LLMProvider, SessionManager, SessionManagerOptions } from './types'

/**
 * Factory: pick the right SessionManager for the requested provider.
 */
export function createSessionManager(options: SessionManagerOptions): SessionManager {
  switch (options.provider) {
    case 'openai':
      return new OpenAISessionManager(options)
    case 'anthropic':
      return new AnthropicSessionManager(options)
    case 'google':
      return new GoogleSessionManager(options)
    case 'claude-code':
      return new ClaudeCodeSessionManager(options)
    case 'codex':
      return new CodexSessionManager(options)
    case 'gemini-cli':
      return new GeminiCliSessionManager(options)
    default:
      throw new Error(`Unsupported LLM provider: ${String((options.provider satisfies never))}`)
  }
}
