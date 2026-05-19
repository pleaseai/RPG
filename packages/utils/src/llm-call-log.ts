import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { createLogger } from './logger'

const log = createLogger('LLMCallLog')

const SCHEMA = `
CREATE TABLE IF NOT EXISTS llm_call_log (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp            INTEGER NOT NULL,
  provider             TEXT    NOT NULL,
  model                TEXT    NOT NULL,
  purpose              TEXT    NOT NULL,
  prompt_hash          TEXT    NOT NULL,
  prompt               TEXT    NOT NULL,
  response             TEXT,
  duration_ms          INTEGER NOT NULL,
  retries              INTEGER NOT NULL DEFAULT 0,
  error                TEXT,
  session_trace_path   TEXT
);
CREATE INDEX IF NOT EXISTS idx_call_log_timestamp ON llm_call_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_call_log_prompt_hash ON llm_call_log(prompt_hash);
`

export interface LLMCallLogOptions {
  /** SQLite file path. Required. */
  dbPath: string
  /** Disable recording. Default: true. */
  enabled?: boolean
}

export interface LLMCallRecord {
  provider: string
  model: string
  purpose: string
  prompt: string
  response?: string
  durationMs: number
  retries: number
  error?: string
  sessionTracePath?: string
}

export interface LLMCallRow {
  id: number
  timestamp: number
  provider: string
  model: string
  purpose: string
  promptHash: string
  prompt: string
  response: string | null
  durationMs: number
  retries: number
  error: string | null
  sessionTracePath: string | null
}

export interface LLMCallLogStats {
  totalCalls: number
  successfulCalls: number
  failedCalls: number
}

/**
 * Persistent SQLite-backed audit trail of every LLM call.
 * Sits alongside SemanticCache — the cache holds canonical outputs,
 * this log holds the per-call history (prompts, durations, errors,
 * trace-file pointers) for debugging and observability.
 */
export class LLMCallLog {
  private readonly options: Required<LLMCallLogOptions>
  private db: Database.Database | null = null
  private _insert: Database.Statement | null = null
  private _recent: Database.Statement | null = null
  private _stats: Database.Statement | null = null

  constructor(options: LLMCallLogOptions) {
    this.options = {
      dbPath: options.dbPath,
      enabled: options.enabled ?? true,
    }
  }

  async record(input: LLMCallRecord): Promise<number> {
    if (!this.options.enabled) {
      return 0
    }
    this.ensureOpen()
    const promptHash = hashPrompt(input.prompt)
    const result = this._insert!.run(
      Date.now(),
      input.provider,
      input.model,
      input.purpose,
      promptHash,
      input.prompt,
      input.response ?? null,
      input.durationMs,
      input.retries,
      input.error ?? null,
      input.sessionTracePath ?? null,
    )
    return Number(result.lastInsertRowid)
  }

  recent(limit = 50): LLMCallRow[] {
    if (!this.options.enabled) {
      return []
    }
    this.ensureOpen()
    const rows = this._recent!.all(limit) as Array<{
      id: number
      timestamp: number
      provider: string
      model: string
      purpose: string
      prompt_hash: string
      prompt: string
      response: string | null
      duration_ms: number
      retries: number
      error: string | null
      session_trace_path: string | null
    }>
    return rows.map(r => ({
      id: r.id,
      timestamp: r.timestamp,
      provider: r.provider,
      model: r.model,
      purpose: r.purpose,
      promptHash: r.prompt_hash,
      prompt: r.prompt,
      response: r.response,
      durationMs: r.duration_ms,
      retries: r.retries,
      error: r.error,
      sessionTracePath: r.session_trace_path,
    }))
  }

  stats(): LLMCallLogStats {
    if (!this.options.enabled) {
      return { totalCalls: 0, successfulCalls: 0, failedCalls: 0 }
    }
    this.ensureOpen()
    const row = this._stats!.get() as { total: number, ok: number, failed: number }
    return {
      totalCalls: row.total,
      successfulCalls: row.ok,
      failedCalls: row.failed,
    }
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      this._insert = null
      this._recent = null
      this._stats = null
    }
  }

  private ensureOpen(): void {
    if (this.db) {
      return
    }
    const dir = path.dirname(this.options.dbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    try {
      this.db = new Database(this.options.dbPath)
      this.db.pragma('journal_mode = WAL')
      this.db.exec(SCHEMA)
    }
    catch (err) {
      log.warn(`Failed to open call log at ${this.options.dbPath}: ${(err as Error).message}`)
      throw err
    }
    this._insert = this.db.prepare(
      `INSERT INTO llm_call_log
       (timestamp, provider, model, purpose, prompt_hash, prompt, response,
        duration_ms, retries, error, session_trace_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    this._recent = this.db.prepare(
      `SELECT id, timestamp, provider, model, purpose, prompt_hash, prompt,
              response, duration_ms, retries, error, session_trace_path
         FROM llm_call_log
        ORDER BY id DESC
        LIMIT ?`,
    )
    this._stats = this.db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN error IS NULL THEN 1 ELSE 0 END) AS ok,
              SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS failed
         FROM llm_call_log`,
    )
  }
}

function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16)
}
