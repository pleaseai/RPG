import type { LanguageModelFactory, SessionManager, SessionManagerOptions } from './types'
import { createOpenAI } from '@ai-sdk/openai'

export class OpenAISessionManager implements SessionManager {
  private readonly options: SessionManagerOptions

  constructor(options: SessionManagerOptions) {
    this.options = options
  }

  createProvider(): LanguageModelFactory {
    return createOpenAI({
      apiKey: this.options.apiKey ?? process.env.OPENAI_API_KEY,
    })
  }
}
