import type { LanguageModelFactory, SessionManager, SessionManagerOptions } from './types'
import { createGoogleGenerativeAI } from '@ai-sdk/google'

export class GoogleSessionManager implements SessionManager {
  private readonly options: SessionManagerOptions

  constructor(options: SessionManagerOptions) {
    this.options = options
  }

  createProvider(): LanguageModelFactory {
    return createGoogleGenerativeAI({
      apiKey: this.options.apiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    })
  }
}
