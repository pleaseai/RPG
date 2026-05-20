import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveGitBinary } from '@pleaseai/soop-utils/git-path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installHooks } from '../../src/commands/hooks'

function g(cwd: string, args: string[]): void {
  execFileSync(resolveGitBinary(), args, { cwd, encoding: 'utf-8' })
}

describe('installHooks (integration)', () => {
  let repo: string
  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'soop-install-hooks-'))
    g(repo, ['init', '-b', 'main'])
  })
  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it('installs all three hooks with SOOP sentinel blocks', async () => {
    await installHooks(repo)
    const hooksDir = path.join(repo, '.git', 'hooks')
    const preCommit = readFileSync(path.join(hooksDir, 'pre-commit'), 'utf-8')
    expect(preCommit).toContain('# SOOP-BEGIN pre-commit')
    expect(preCommit).toContain('soop sync --staged-only')

    const postMerge = readFileSync(path.join(hooksDir, 'post-merge'), 'utf-8')
    expect(postMerge).toContain('# SOOP-BEGIN post-merge')
    expect(postMerge).toContain('soop sync')
    expect(postMerge).not.toContain('--staged-only')

    const postCheckout = readFileSync(path.join(hooksDir, 'post-checkout'), 'utf-8')
    expect(postCheckout).toContain('# SOOP-BEGIN post-checkout')
  })

  it('is byte-identical when run twice (idempotent)', async () => {
    await installHooks(repo)
    const hookPath = path.join(repo, '.git', 'hooks', 'pre-commit')
    const after1 = readFileSync(hookPath, 'utf-8')
    await installHooks(repo)
    const after2 = readFileSync(hookPath, 'utf-8')
    expect(after2).toBe(after1)
  })

  it('skips when not a git repo', async () => {
    const nonRepo = mkdtempSync(path.join(tmpdir(), 'soop-nogit-'))
    try {
      // Should not throw
      await installHooks(nonRepo)
    }
    finally {
      rmSync(nonRepo, { recursive: true, force: true })
    }
  })
})
