import type { ClaudeCodeSettings } from 'ai-sdk-provider-claude-code'
import type { LanguageModelFactory, SessionManager, SessionManagerOptions } from './types'
import { spawn } from 'node:child_process'
import { createClaudeCode } from 'ai-sdk-provider-claude-code'
import { createLogger } from '../logger'

const log = createLogger('ClaudeCodeSession')

export class ClaudeCodeSessionManager implements SessionManager {
  private readonly options: SessionManagerOptions

  constructor(options: SessionManagerOptions) {
    this.options = options
  }

  createProvider(): LanguageModelFactory {
    const settings = this.buildSettings()
    return createClaudeCode({ defaultSettings: settings })
  }

  /**
   * Merge user-supplied claudeCodeSettings on top of the automation-friendly
   * defaults. Overrides `spawnClaudeCodeProcess` so that `CLAUDECODE` and
   * `CLAUDE_CODE_SSE_PORT` env vars are stripped — otherwise nesting Claude
   * Code inside an existing session is blocked.
   */
  private buildSettings(): ClaudeCodeSettings {
    return {
      pathToClaudeCodeExecutable: process.env.CLAUDE_BIN ?? 'claude',
      persistSession: false,
      permissionMode: 'bypassPermissions',
      ...this.options.claudeCodeSettings,
      stderr: (data) => { log.debug('[claude stderr]', data.toString().trim()) },
      spawnClaudeCodeProcess: (spawnOptions) => {
        const { CLAUDECODE: _, CLAUDE_CODE_SSE_PORT: __, ...env } = spawnOptions.env
        return spawn(spawnOptions.command, spawnOptions.args, {
          cwd: spawnOptions.cwd,
          env,
          signal: spawnOptions.signal,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      },
    }
  }
}
