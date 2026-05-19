import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logToolCall } from '@pleaseai/soop-mcp/telemetry'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('telemetry.logToolCall', () => {
  let tmp: string
  let originalLog: string | undefined
  let originalEnabled: string | undefined

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'soop-mcp-telemetry-'))
    originalLog = process.env.SOOP_MCP_CALLS_LOG
    originalEnabled = process.env.SOOP_MCP_TELEMETRY
  })

  afterEach(async () => {
    if (originalLog === undefined) {
      delete process.env.SOOP_MCP_CALLS_LOG
    }
    else {
      process.env.SOOP_MCP_CALLS_LOG = originalLog
    }
    if (originalEnabled === undefined) {
      delete process.env.SOOP_MCP_TELEMETRY
    }
    else {
      process.env.SOOP_MCP_TELEMETRY = originalEnabled
    }
    await rm(tmp, { recursive: true, force: true })
  })

  it('appends a JSONL record to the configured path and creates parent dirs', async () => {
    const logPath = join(tmp, 'nested', 'calls.jsonl')
    process.env.SOOP_MCP_CALLS_LOG = logPath
    delete process.env.SOOP_MCP_TELEMETRY

    const ok = await logToolCall({
      tool: 'soop_search',
      params: { mode: 'auto' },
      summary: { nodes: 3 },
      durationMs: 42,
    })

    expect(ok).toBe(true)
    const lines = (await readFile(logPath, 'utf-8')).trim().split('\n')
    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0]!)
    expect(record.tool).toBe('soop_search')
    expect(record.summary).toEqual({ nodes: 3 })
    expect(record.durationMs).toBe(42)
    expect(record.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('appends additional calls to the same file', async () => {
    const logPath = join(tmp, 'calls.jsonl')
    process.env.SOOP_MCP_CALLS_LOG = logPath
    delete process.env.SOOP_MCP_TELEMETRY

    await logToolCall({ tool: 'a', params: {}, summary: {}, durationMs: 1 })
    await logToolCall({ tool: 'b', params: {}, summary: {}, durationMs: 2 })

    const lines = (await readFile(logPath, 'utf-8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!).tool).toBe('a')
    expect(JSON.parse(lines[1]!).tool).toBe('b')
  })

  it('is a no-op when SOOP_MCP_TELEMETRY=0', async () => {
    const logPath = join(tmp, 'should-not-exist.jsonl')
    process.env.SOOP_MCP_CALLS_LOG = logPath
    process.env.SOOP_MCP_TELEMETRY = '0'

    const ok = await logToolCall({ tool: 'x', params: {}, summary: {}, durationMs: 0 })
    expect(ok).toBe(false)

    await expect(readFile(logPath, 'utf-8')).rejects.toThrow()
  })

  it('records error metadata when present', async () => {
    const logPath = join(tmp, 'errors.jsonl')
    process.env.SOOP_MCP_CALLS_LOG = logPath
    delete process.env.SOOP_MCP_TELEMETRY

    await logToolCall({
      tool: 'soop_stats',
      params: {},
      summary: {},
      durationMs: 5,
      error: { code: 'RPG_NOT_LOADED', message: 'no graph' },
    })

    const record = JSON.parse((await readFile(logPath, 'utf-8')).trim())
    expect(record.error).toEqual({ code: 'RPG_NOT_LOADED', message: 'no graph' })
  })
})
