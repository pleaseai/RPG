import type { LanguageModelFactory, SessionManager, SessionManagerOptions } from './types'
import { createGeminiProvider } from 'ai-sdk-provider-gemini-cli'

export class GeminiCliSessionManager implements SessionManager {
  private readonly options: SessionManagerOptions

  constructor(options: SessionManagerOptions) {
    this.options = options
  }

  createProvider(): LanguageModelFactory {
    return createGeminiProvider(this.options.geminiCliSettings ?? {})
  }
}
