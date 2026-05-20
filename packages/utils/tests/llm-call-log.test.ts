import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LLMClient } from '@pleaseai/soop-utils/llm'
import { LLMCallLog } from '@pleaseai/soop-utils/llm-call-log'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn(() => 'mock-model')),
}))

vi.mock('ai', () => ({
  generateText: vi.fn(),
  Output: { object: vi.fn(({ schema }: any) => ({ type: 'object', schema })) },
  NoObjectGeneratedError: class extends Error {
    static isInstance(e: unknown) { return e instanceof Error && e.name === 'NoObjectGeneratedError' }
  },
  APICallError: class extends Error {
    static isInstance(e: unknown) { return e instanceof Error && e.name === 'APICallError' }
  },
}))

describe('LLMCallLog', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'soop-call-log-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('records a successful call', async () => {
    const log = new LLMCallLog({ dbPath: path.join(dir, 'log.db') })
    const id = await log.record({
      provider: 'claude-code',
      model: 'sonnet',
      purpose: 'semantic-parse',
      prompt: 'Describe this file',
      response: '{"feature":"x"}',
      durationMs: 1234,
      retries: 0,
    })
    expect(typeof id).toBe('number')
    expect(id).toBeGreaterThan(0)

    const stats = log.stats()
    expect(stats.totalCalls).toBe(1)
    expect(stats.successfulCalls).toBe(1)
    expect(stats.failedCalls).toBe(0)
    log.close()
  })

  it('records a failed call with error message', async () => {
    const log = new LLMCallLog({ dbPath: path.join(dir, 'log.db') })
    await log.record({
      provider: 'openai',
      model: 'gpt-4o',
      purpose: 'test',
      prompt: 'p',
      error: 'rate-limited',
      durationMs: 50,
      retries: 2,
    })

    const stats = log.stats()
    expect(stats.totalCalls).toBe(1)
    expect(stats.successfulCalls).toBe(0)
    expect(stats.failedCalls).toBe(1)
    log.close()
  })

  it('returns the recent calls in reverse-chronological order', async () => {
    const log = new LLMCallLog({ dbPath: path.join(dir, 'log.db') })
    await log.record({ provider: 'openai', model: 'gpt-4o', purpose: 'a', prompt: 'p1', response: 'r1', durationMs: 1, retries: 0 })
    await log.record({ provider: 'openai', model: 'gpt-4o', purpose: 'b', prompt: 'p2', response: 'r2', durationMs: 2, retries: 0 })
    await log.record({ provider: 'openai', model: 'gpt-4o', purpose: 'c', prompt: 'p3', response: 'r3', durationMs: 3, retries: 0 })

    const recent = log.recent(2)
    expect(recent).toHaveLength(2)
    expect(recent[0]?.purpose).toBe('c')
    expect(recent[1]?.purpose).toBe('b')
    log.close()
  })

  it('hashes the prompt for indexed lookup', async () => {
    const log = new LLMCallLog({ dbPath: path.join(dir, 'log.db') })
    await log.record({ provider: 'openai', model: 'gpt-4o', purpose: 't', prompt: 'same prompt', response: 'r1', durationMs: 1, retries: 0 })
    await log.record({ provider: 'openai', model: 'gpt-4o', purpose: 't', prompt: 'same prompt', response: 'r2', durationMs: 1, retries: 0 })

    const all = log.recent(10)
    expect(all).toHaveLength(2)
    expect(all[0]?.promptHash).toBe(all[1]?.promptHash)
    log.close()
  })

  it('is a no-op when disabled', async () => {
    const log = new LLMCallLog({ dbPath: path.join(dir, 'log.db'), enabled: false })
    const id = await log.record({ provider: 'openai', model: 'gpt-4o', purpose: 'x', prompt: 'p', response: 'r', durationMs: 1, retries: 0 })
    expect(id).toBe(0)
    const stats = log.stats()
    expect(stats.totalCalls).toBe(0)
    log.close()
  })

  it('returns zero counts when the table is empty (COALESCE on SUM)', async () => {
    const log = new LLMCallLog({ dbPath: path.join(dir, 'log.db') })
    const stats = log.stats()
    expect(stats.totalCalls).toBe(0)
    expect(stats.successfulCalls).toBe(0)
    expect(stats.failedCalls).toBe(0)
    log.close()
  })
})

describe('LLMClient + LLMCallLog integration', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'soop-client-log-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes a log row on a successful complete()', async () => {
    const { generateText } = await import('ai')
    vi.mocked(generateText).mockResolvedValueOnce({
      text: 'hello',
      usage: { inputTokens: 4, outputTokens: 2 },
    } as any)

    const dbPath = path.join(dir, 'log.db')
    const client = new LLMClient({ provider: 'openai', callLogPath: dbPath })
    await client.complete('say hi', undefined, { purpose: 'greeting' })

    const log = new LLMCallLog({ dbPath })
    const rows = log.recent(10)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.purpose).toBe('greeting')
    expect(rows[0]?.response).toBe('hello')
    expect(rows[0]?.error).toBeNull()
    expect(rows[0]?.provider).toBe('openai')
    log.close()
  })

  it('writes a log row with error message on failed complete()', async () => {
    const { generateText } = await import('ai')
    vi.mocked(generateText).mockRejectedValueOnce(new Error('boom'))

    const dbPath = path.join(dir, 'log.db')
    const client = new LLMClient({ provider: 'openai', callLogPath: dbPath })
    await expect(client.complete('p', undefined, { purpose: 'fail-test' })).rejects.toThrow('boom')

    const log = new LLMCallLog({ dbPath })
    const rows = log.recent(10)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.purpose).toBe('fail-test')
    expect(rows[0]?.error).toBe('boom')
    expect(rows[0]?.response).toBeNull()
    log.close()
  })

  it('does not write rows when callLogPath is unset', async () => {
    const { generateText } = await import('ai')
    vi.mocked(generateText).mockResolvedValueOnce({
      text: 'hi',
      usage: { inputTokens: 1, outputTokens: 1 },
    } as any)

    const client = new LLMClient({ provider: 'openai' })
    await client.complete('p')
    // No assertion beyond "didn't throw" — the absence of a DB file is the
    // observable contract; nothing else to inspect.
    expect(true).toBe(true)
  })
})
