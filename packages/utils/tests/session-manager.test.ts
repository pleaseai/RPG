import { createSessionManager } from '@pleaseai/soop-utils/session-manager'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn(() => 'mock-openai-model')),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => 'mock-anthropic-model')),
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn(() => 'mock-google-model')),
}))

vi.mock('ai-sdk-provider-claude-code', () => ({
  createClaudeCode: vi.fn(() => vi.fn(() => 'mock-claude-code-model')),
}))

vi.mock('ai-sdk-provider-codex-cli', () => ({
  createCodexCli: vi.fn(() => vi.fn(() => 'mock-codex-model')),
}))

vi.mock('ai-sdk-provider-gemini-cli', () => ({
  createGeminiProvider: vi.fn(() => vi.fn(() => 'mock-gemini-cli-model')),
}))

describe('createSessionManager', () => {
  it('returns a SessionManager for openai', () => {
    const manager = createSessionManager({ provider: 'openai', apiKey: 'sk-test' })
    expect(manager).toBeDefined()
    expect(typeof manager.createProvider).toBe('function')
    const provider = manager.createProvider()
    expect(typeof provider).toBe('function')
    expect(provider('gpt-4o')).toBe('mock-openai-model')
  })

  it('returns a SessionManager for anthropic', () => {
    const manager = createSessionManager({ provider: 'anthropic', apiKey: 'sk-ant-test' })
    const provider = manager.createProvider()
    expect(provider('claude-haiku-4-5')).toBe('mock-anthropic-model')
  })

  it('returns a SessionManager for google', () => {
    const manager = createSessionManager({ provider: 'google', apiKey: 'AIza-test' })
    const provider = manager.createProvider()
    expect(provider('gemini-2.5-flash')).toBe('mock-google-model')
  })

  it('returns a SessionManager for claude-code', () => {
    const manager = createSessionManager({ provider: 'claude-code' })
    const provider = manager.createProvider()
    expect(provider('claude-haiku-4-5')).toBe('mock-claude-code-model')
  })

  it('returns a SessionManager for codex', () => {
    const manager = createSessionManager({ provider: 'codex' })
    const provider = manager.createProvider()
    expect(provider('gpt-5-codex')).toBe('mock-codex-model')
  })

  it('returns a SessionManager for gemini-cli', () => {
    const manager = createSessionManager({ provider: 'gemini-cli' })
    const provider = manager.createProvider()
    expect(provider('gemini-2.5-pro')).toBe('mock-gemini-cli-model')
  })

  it('throws for unknown provider', () => {
    expect(() => createSessionManager({ provider: 'unknown' as never })).toThrow(/Unsupported/)
  })

  it('claude-code manager merges spawn override and default settings', async () => {
    const { createClaudeCode } = await import('ai-sdk-provider-claude-code')
    vi.mocked(createClaudeCode).mockClear()

    createSessionManager({ provider: 'claude-code' }).createProvider()

    expect(vi.mocked(createClaudeCode)).toHaveBeenCalledTimes(1)
    const call = vi.mocked(createClaudeCode).mock.calls[0]
    const settings = call[0]?.defaultSettings
    expect(settings).toBeDefined()
    expect(settings).toMatchObject({
      persistSession: false,
      permissionMode: 'bypassPermissions',
    })
    expect(typeof settings?.spawnClaudeCodeProcess).toBe('function')
    expect(typeof settings?.stderr).toBe('function')
  })

  it('claude-code manager respects user-provided claudeCodeSettings overrides', async () => {
    const { createClaudeCode } = await import('ai-sdk-provider-claude-code')
    vi.mocked(createClaudeCode).mockClear()

    createSessionManager({
      provider: 'claude-code',
      claudeCodeSettings: { cwd: '/tmp/test', maxTurns: 5 },
    }).createProvider()

    const settings = vi.mocked(createClaudeCode).mock.calls[0][0]?.defaultSettings
    expect(settings).toMatchObject({ cwd: '/tmp/test', maxTurns: 5 })
  })
})
