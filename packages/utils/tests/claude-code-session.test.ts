import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ClaudeCodeSessionManager } from '@pleaseai/soop-utils/session-manager/claude-code'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('ai-sdk-provider-claude-code', () => ({
  createClaudeCode: vi.fn((opts: any) => {
    const factory = vi.fn((modelId: string) => ({
      __mock: true,
      modelId,
      sessionId: opts?.defaultSettings?.sessionId,
    }))
    return factory
  }),
}))

describe('ClaudeCodeSessionManager.beginCall', () => {
  it('returns a CallSession with disableAiSdkRetry=true', () => {
    const manager = new ClaudeCodeSessionManager({ provider: 'claude-code' })
    const session = manager.beginCall('sonnet', 'test')
    expect(session.disableAiSdkRetry).toBe(true)
  })

  it('each beginCall produces a distinct session UUID', () => {
    const manager = new ClaudeCodeSessionManager({ provider: 'claude-code' })
    const s1 = manager.beginCall('sonnet', 'test')
    const s2 = manager.beginCall('sonnet', 'test')
    const id1 = (s1.model as any).sessionId
    const id2 = (s2.model as any).sessionId
    expect(id1).toBeDefined()
    expect(id2).toBeDefined()
    expect(id1).not.toBe(id2)
  })

  it('regenerate() swaps the model to one with a new sessionId', () => {
    const manager = new ClaudeCodeSessionManager({ provider: 'claude-code' })
    const session = manager.beginCall('sonnet', 'test')
    const idBefore = (session.model as any).sessionId
    session.regenerate()
    const idAfter = (session.model as any).sessionId
    expect(idAfter).not.toBe(idBefore)
  })
})

describe('ClaudeCodeSessionManager trace capture', () => {
  let traceDir: string
  let homeShim: string

  beforeEach(async () => {
    traceDir = await mkdtemp(path.join(tmpdir(), 'soop-trace-'))
    homeShim = await mkdtemp(path.join(tmpdir(), 'soop-home-'))
  })

  afterEach(async () => {
    await rm(traceDir, { recursive: true, force: true })
    await rm(homeShim, { recursive: true, force: true })
  })

  it('finalize copies the session JSONL into sessionTraceDir', async () => {
    const cwd = '/Users/test/project'
    const encoded = '-Users-test-project'
    const projectsDir = path.join(homeShim, '.claude', 'projects', encoded)
    await mkdir(projectsDir, { recursive: true })

    const manager = new ClaudeCodeSessionManager({
      provider: 'claude-code',
      sessionTraceDir: traceDir,
      claudeProjectsRoot: path.join(homeShim, '.claude', 'projects'),
      workspaceCwd: cwd,
    })

    const session = manager.beginCall('sonnet', 'semantic-parse')
    const sessionId = (session.model as any).sessionId
    const jsonlPath = path.join(projectsDir, `${sessionId}.jsonl`)
    await writeFile(jsonlPath, '{"event":"sample"}\n')

    await session.finalize({ success: true })

    const captured = await readdir(traceDir)
    expect(captured).toHaveLength(1)
    expect(captured[0]).toContain('semantic-parse')
    expect(captured[0]?.endsWith('.jsonl')).toBe(true)

    const content = await readFile(path.join(traceDir, captured[0]!), 'utf8')
    expect(content).toBe('{"event":"sample"}\n')
  })

  it('finalize is a no-op when sessionTraceDir is not configured', async () => {
    const manager = new ClaudeCodeSessionManager({ provider: 'claude-code' })
    const session = manager.beginCall('sonnet', 'noop')
    await expect(session.finalize({ success: true })).resolves.toBeUndefined()
  })

  it('finalize silently skips when the source JSONL does not exist', async () => {
    const manager = new ClaudeCodeSessionManager({
      provider: 'claude-code',
      sessionTraceDir: traceDir,
      claudeProjectsRoot: path.join(homeShim, '.claude', 'projects'),
      workspaceCwd: '/missing/project',
    })

    const session = manager.beginCall('sonnet', 'noop')
    await session.finalize({ success: true })

    const captured = await readdir(traceDir)
    expect(captured).toHaveLength(0)
  })
})
