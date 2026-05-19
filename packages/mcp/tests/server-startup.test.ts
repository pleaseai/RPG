import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tryLoadRPG } from '@pleaseai/soop-mcp/server'
import {
  SOOP_SERVER_INSTRUCTIONS,
  SOOP_TOOL_ANNOTATIONS,
  SOOP_TOOLS,
} from '@pleaseai/soop-mcp/tools'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('tryLoadRPG', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'soop-mcp-load-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('returns an invalid_path code without throwing for missing or unreadable paths', async () => {
    const result = await tryLoadRPG(join(tmp, 'missing.json'))
    expect(result.rpg).toBeNull()
    if (result.rpg === null) {
      // ENOENT (missing) and EACCES (permission-denied) both map here —
      // hence the broader "invalid_path" label rather than "file_not_found".
      expect(result.errorCode).toBe('invalid_path')
    }
  })

  it('returns a load_failed code for malformed JSON without throwing', async () => {
    const bad = join(tmp, 'bad.json')
    await writeFile(bad, '{ not valid json')
    const result = await tryLoadRPG(bad)
    expect(result.rpg).toBeNull()
    if (result.rpg === null) {
      expect(result.errorCode).toBe('load_failed')
      expect(result.errorMessage.length).toBeGreaterThan(0)
    }
  })

  it('is safe to call concurrently with a missing path', async () => {
    // Sanity check that the function is reentrant — used by the server's
    // requireRpg path where multiple tool calls may race on the same load.
    const missing = join(tmp, 'still-missing.json')
    const results = await Promise.all([
      tryLoadRPG(missing),
      tryLoadRPG(missing),
      tryLoadRPG(missing),
    ])
    for (const r of results) {
      expect(r.rpg).toBeNull()
      if (r.rpg === null)
        expect(r.errorCode).toBe('invalid_path')
    }
  })
})

describe('SOOP_SERVER_INSTRUCTIONS', () => {
  it('describes every registered tool', () => {
    for (const toolName of Object.keys(SOOP_TOOLS)) {
      expect(SOOP_SERVER_INSTRUCTIONS).toContain(toolName)
    }
  })

  it('points the agent at the rpg_unavailable recovery path', () => {
    expect(SOOP_SERVER_INSTRUCTIONS).toContain('RPG_NOT_LOADED')
    expect(SOOP_SERVER_INSTRUCTIONS).toContain('nextStep')
  })
})

describe('SOOP_TOOL_ANNOTATIONS', () => {
  it('marks read-only tools with readOnlyHint=true', () => {
    expect(SOOP_TOOL_ANNOTATIONS.soop_search.readOnlyHint).toBe(true)
    expect(SOOP_TOOL_ANNOTATIONS.soop_fetch.readOnlyHint).toBe(true)
    expect(SOOP_TOOL_ANNOTATIONS.soop_explore.readOnlyHint).toBe(true)
    expect(SOOP_TOOL_ANNOTATIONS.soop_stats.readOnlyHint).toBe(true)
  })

  it('marks mutating tools with openWorldHint=true', () => {
    expect(SOOP_TOOL_ANNOTATIONS.soop_encode.openWorldHint).toBe(true)
    expect(SOOP_TOOL_ANNOTATIONS.soop_evolve.openWorldHint).toBe(true)
    expect(SOOP_TOOL_ANNOTATIONS.soop_encode.readOnlyHint).toBe(false)
    expect(SOOP_TOOL_ANNOTATIONS.soop_evolve.readOnlyHint).toBe(false)
  })

  it('covers every tool in SOOP_TOOLS', () => {
    for (const toolName of Object.keys(SOOP_TOOLS)) {
      expect(SOOP_TOOL_ANNOTATIONS).toHaveProperty(toolName)
    }
  })
})
