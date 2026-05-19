/**
 * MCP tool-call telemetry — append-only JSONL log.
 *
 * Mirrors the `_log_tool_call` helper in the Python reference at
 * `vendor/RPG-ZeroRepo/RPG-Kit/scripts/mcp_server.py`. Best-effort: never
 * raises and never affects the tool's response, so a failed log write
 * cannot break an MCP call.
 *
 * Configuration via env vars:
 *   - `SOOP_MCP_TELEMETRY=0` disables logging entirely.
 *   - `SOOP_MCP_CALLS_LOG=/abs/path.jsonl` overrides the default log path.
 *
 * Default log path: `<cwd>/.soop/local/mcp-calls.jsonl` — under
 * `.soop/local/` which is gitignored per the project's two-tier RPG
 * architecture (see CLAUDE.md).
 */
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface ToolCallRecord {
  tool: string
  params: unknown
  summary: Record<string, unknown>
  durationMs: number
  error?: { code: string, message: string }
}

function resolveLogPath(): string {
  const override = process.env.SOOP_MCP_CALLS_LOG
  if (override && override.length > 0) {
    return override
  }
  return join(process.cwd(), '.soop', 'local', 'mcp-calls.jsonl')
}

/**
 * Append a single JSONL record describing a tool call.
 *
 * @returns `true` if the record was written, `false` otherwise (disabled
 * by env var, or write failed). Callers can ignore the return value —
 * it is exposed only for testing.
 */
export async function logToolCall(record: ToolCallRecord): Promise<boolean> {
  if (process.env.SOOP_MCP_TELEMETRY === '0') {
    return false
  }
  try {
    const logPath = resolveLogPath()
    await mkdir(dirname(logPath), { recursive: true })
    const line = `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`
    await appendFile(logPath, line, 'utf-8')
    return true
  }
  catch {
    // Best-effort: telemetry must never break a tool call.
    return false
  }
}
