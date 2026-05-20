import type { LanguageModelFactory, SessionManager, SessionManagerOptions } from './types'
import { createAnthropic } from '@ai-sdk/anthropic'

export class AnthropicSessionManager implements SessionManager {
  private readonly options: SessionManagerOptions

  constructor(options: SessionManagerOptions) {
    this.options = options
  }

  createProvider(): LanguageModelFactory {
    return createAnthropic({
      apiKey: this.options.apiKey ?? process.env.ANTHROPIC_API_KEY,
    })
  }
}
