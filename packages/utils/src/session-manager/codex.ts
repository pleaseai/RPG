import type { LanguageModelFactory, SessionManager, SessionManagerOptions } from './types'
import { createCodexCli } from 'ai-sdk-provider-codex-cli'

export class CodexSessionManager implements SessionManager {
  private readonly options: SessionManagerOptions

  constructor(options: SessionManagerOptions) {
    this.options = options
  }

  createProvider(): LanguageModelFactory {
    return createCodexCli(
      this.options.codexSettings
        ? { defaultSettings: this.options.codexSettings }
        : undefined,
    )
  }
}
