import type { ClaudeCodeSettings } from 'ai-sdk-provider-claude-code'
import type { CallSession, LanguageModelFactory, SessionManager, SessionManagerOptions } from './types'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { createClaudeCode } from 'ai-sdk-provider-claude-code'
import { createLogger } from '../logger'

const log = createLogger('ClaudeCodeSession')

const PROJECT_PATH_SLASH = /\//g
const PROJECT_PATH_UNDERSCORE = /_/g
const PURPOSE_UNSAFE = /[^\w-]/g

/** `/Users/foo/My_Project` → `-Users-foo-My-Project` (Claude project-dir encoding). */
export function encodeClaudeProjectPath(absPath: string): string {
  return absPath.replace(PROJECT_PATH_SLASH, '-').replace(PROJECT_PATH_UNDERSCORE, '-')
}

export class ClaudeCodeSessionManager implements SessionManager {
  private readonly options: SessionManagerOptions

  constructor(options: SessionManagerOptions) {
    this.options = options
  }

  /**
   * Build a default provider instance with no preset sessionId — used when
   * `beginCall()` isn't taken (currently never, but kept for interface
   * conformance and direct provider access).
   */
  createProvider(): LanguageModelFactory {
    const settings = this.buildSettings()
    return createClaudeCode({ defaultSettings: settings })
  }

  beginCall(modelId: string, purpose: string): CallSession {
    let sessionId = randomUUID()
    let model = this.buildModel(modelId, sessionId)

    const finalize = async (_outcome: { success: boolean }): Promise<void> => {
      if (!this.options.sessionTraceDir) {
        return
      }
      await this.captureTrace(sessionId, purpose)
    }

    return {
      get model() { return model },
      disableAiSdkRetry: true,
      regenerate: () => {
        sessionId = randomUUID()
        model = this.buildModel(modelId, sessionId)
      },
      finalize,
    }
  }

  private buildModel(modelId: string, sessionId: string) {
    const settings = this.buildSettings(sessionId)
    const factory = createClaudeCode({ defaultSettings: settings })
    return factory(modelId)
  }

  /**
   * Merge user-supplied claudeCodeSettings on top of automation-friendly
   * defaults. Overrides `spawnClaudeCodeProcess` to strip `CLAUDECODE` /
   * `CLAUDE_CODE_SSE_PORT` env vars so nested sessions aren't blocked.
   */
  private buildSettings(sessionId?: string): ClaudeCodeSettings {
    return {
      pathToClaudeCodeExecutable: process.env.CLAUDE_BIN ?? 'claude',
      persistSession: false,
      permissionMode: 'bypassPermissions',
      ...this.options.claudeCodeSettings,
      ...(sessionId !== undefined && { sessionId }),
      stderr: (data) => { log.debug('[claude stderr]', data.toString().trim()) },
      spawnClaudeCodeProcess: (spawnOptions) => {
        const { CLAUDECODE: _, CLAUDE_CODE_SSE_PORT: __, ...env } = spawnOptions.env ?? process.env
        return spawn(spawnOptions.command, spawnOptions.args, {
          cwd: spawnOptions.cwd,
          env,
          signal: spawnOptions.signal,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      },
    }
  }

  /**
   * Locate `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` produced by
   * the just-completed Claude session and copy it into `sessionTraceDir`
   * with a timestamped filename. Silently no-ops if the source is missing
   * (the CLI may not have written the file for a failed attempt).
   */
  private async captureTrace(sessionId: string, purpose: string): Promise<void> {
    const traceDir = this.options.sessionTraceDir
    if (!traceDir) {
      return
    }
    const projectsRoot = this.options.claudeProjectsRoot ?? path.join(homedir(), '.claude', 'projects')
    const cwd = this.options.workspaceCwd ?? process.cwd()
    const encoded = encodeClaudeProjectPath(cwd)
    const source = path.join(projectsRoot, encoded, `${sessionId}.jsonl`)

    try {
      await stat(source)
    }
    catch {
      log.debug(`No session trace at ${source} — skipping capture`)
      return
    }

    await mkdir(traceDir, { recursive: true })
    const ts = formatTimestamp(new Date())
    const safePurpose = purpose.replace(PURPOSE_UNSAFE, '_')
    const shortId = sessionId.slice(0, 8)
    const dest = path.join(traceDir, `${ts}-${safePurpose}-${shortId}.jsonl`).split(path.sep).join('/')
    try {
      await copyFile(source, dest)
      log.debug(`Captured Claude session trace: ${dest}`)
    }
    catch (err) {
      log.warn(`Failed to capture Claude session trace: ${(err as Error).message}`)
    }
  }
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
    + `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}
