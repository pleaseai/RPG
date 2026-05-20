import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installHookSnippet, stripHookBlock } from '../../src/hooks/installer'

describe('installHookSnippet', () => {
  let hooksDir: string
  beforeEach(() => { hooksDir = mkdtempSync(path.join(tmpdir(), 'soop-installer-')) })
  afterEach(() => rmSync(hooksDir, { recursive: true, force: true }))

  it('creates hook with #!/bin/sh shebang when file absent', () => {
    const p = installHookSnippet(hooksDir, 'pre-commit', 'pre-commit', 'echo hi')
    const content = readFileSync(p, 'utf-8')
    expect(content.startsWith('#!/bin/sh\n')).toBe(true)
    expect(content).toContain('# SOOP-BEGIN pre-commit')
    expect(content).toContain('echo hi')
    expect(content).toContain('# SOOP-END pre-commit')
    expect(statSync(p).mode & 0o111).not.toBe(0)
  })

  it('preserves user-authored shebang', () => {
    const hookPath = path.join(hooksDir, 'pre-commit')
    writeFileSync(hookPath, '#!/usr/bin/env bash\necho user\n')
    installHookSnippet(hooksDir, 'pre-commit', 'pre-commit', 'echo soop')
    const content = readFileSync(hookPath, 'utf-8')
    expect(content.startsWith('#!/usr/bin/env bash\n')).toBe(true)
    expect(content).toContain('echo user')
    expect(content).toContain('echo soop')
  })

  it('is idempotent — running 3 times produces identical output', () => {
    installHookSnippet(hooksDir, 'pre-commit', 'pre-commit', 'echo a')
    const after1 = readFileSync(path.join(hooksDir, 'pre-commit'), 'utf-8')
    installHookSnippet(hooksDir, 'pre-commit', 'pre-commit', 'echo a')
    const after2 = readFileSync(path.join(hooksDir, 'pre-commit'), 'utf-8')
    installHookSnippet(hooksDir, 'pre-commit', 'pre-commit', 'echo a')
    const after3 = readFileSync(path.join(hooksDir, 'pre-commit'), 'utf-8')
    expect(after2).toBe(after1)
    expect(after3).toBe(after1)
  })

  it('replaces the sentinel block atomically on body change', () => {
    installHookSnippet(hooksDir, 'pre-commit', 'pre-commit', 'echo OLD')
    installHookSnippet(hooksDir, 'pre-commit', 'pre-commit', 'echo NEW')
    const content = readFileSync(path.join(hooksDir, 'pre-commit'), 'utf-8')
    expect(content).toContain('echo NEW')
    expect(content).not.toContain('echo OLD')
    // Only one BEGIN/END pair
    expect(content.match(/# SOOP-BEGIN pre-commit/g)?.length).toBe(1)
    expect(content.match(/# SOOP-END pre-commit/g)?.length).toBe(1)
  })

  it('migrates legacy snippet via legacyBlocks option', () => {
    const hookPath = path.join(hooksDir, 'pre-commit')
    writeFileSync(
      hookPath,
      `${[
        '#!/bin/sh',
        '# Old SOOP marker',
        'echo legacy line 1',
        'echo legacy line 2',
        '# Unrelated user line',
      ].join('\n')}\n`,
    )
    installHookSnippet(hooksDir, 'pre-commit', 'pre-commit', 'echo new', {
      legacyBlocks: [{ marker: '# Old SOOP marker', lineCount: 3 }],
    })
    const content = readFileSync(hookPath, 'utf-8')
    expect(content).not.toContain('# Old SOOP marker')
    expect(content).not.toContain('echo legacy line 1')
    expect(content).not.toContain('echo legacy line 2')
    expect(content).toContain('# Unrelated user line')
    expect(content).toContain('echo new')
  })

  it('multi-line body is preserved', () => {
    installHookSnippet(
      hooksDir,
      'pre-commit',
      'pre-commit',
      'cmd1\ncmd2\ncmd3',
    )
    const content = readFileSync(path.join(hooksDir, 'pre-commit'), 'utf-8')
    expect(content).toContain('cmd1\ncmd2\ncmd3')
  })
})

describe('stripHookBlock', () => {
  it('strips sentinel block but preserves user content', () => {
    const input = [
      '#!/bin/sh',
      'echo user',
      '# SOOP-BEGIN test',
      'echo managed',
      '# SOOP-END test',
      'echo after',
    ].join('\n')
    expect(stripHookBlock(input, 'test')).toBe(
      ['#!/bin/sh', 'echo user', 'echo after'].join('\n'),
    )
  })

  it('strips multiple legacy blocks', () => {
    const input = [
      'echo top',
      '# legacy A',
      'a1',
      '# legacy B',
      'b1',
      'b2',
      'echo bottom',
    ].join('\n')
    expect(
      stripHookBlock(input, 'unused', [
        { marker: '# legacy A', lineCount: 2 },
        { marker: '# legacy B', lineCount: 3 },
      ]),
    ).toBe(['echo top', 'echo bottom'].join('\n'))
  })

  it('returns input unchanged when no markers match', () => {
    const input = ['#!/bin/sh', 'echo hi'].join('\n')
    expect(stripHookBlock(input, 'unused')).toBe(input)
  })
})
