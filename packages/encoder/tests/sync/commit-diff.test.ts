import type { GitMeta } from '@pleaseai/soop-graph/meta'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveGitBinary } from '@pleaseai/soop-utils/git-path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decideSyncFromCommitDiff, DEFAULT_INCREMENTAL_FILE_LIMIT } from '../../src/sync/commit-diff'

function g(cwd: string, args: string[]): string {
  return execFileSync(resolveGitBinary(), args, { cwd, encoding: 'utf-8' }).trim()
}
function commit(cwd: string, msg: string): string {
  execFileSync(resolveGitBinary(), ['commit', '-m', msg], { cwd, encoding: 'utf-8' })
  return g(cwd, ['rev-parse', 'HEAD'])
}
function setupRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'soop-decide-'))
  g(dir, ['init', '-b', 'main'])
  g(dir, ['config', 'user.email', 't@t.com'])
  g(dir, ['config', 'user.name', 't'])
  writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1')
  g(dir, ['add', '.'])
  return dir
}
function readHeadSha(dir: string): string {
  return g(dir, ['rev-parse', 'HEAD'])
}
function metaAt(sha: string, branch = 'main'): GitMeta {
  return { headCommit: sha, headShort: sha.slice(0, 7), headBranch: branch, headTimestamp: null }
}

describe('decideSyncFromCommitDiff — decision tree', () => {
  let dir: string
  let c1: string

  beforeEach(() => {
    dir = setupRepo()
    c1 = commit(dir, 'c1')
  })
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }) }
    catch { /* best-effort cleanup; OS may race on .git/index unlink */ }
  })

  it('forceFull=true → full / force_full', () => {
    const d = decideSyncFromCommitDiff(dir, metaAt(c1), { forceFull: true })
    expect(d.mode).toBe('full')
    expect(d.reason).toBe('force_full')
  })

  it('gitMeta missing → full / baseline', () => {
    const d = decideSyncFromCommitDiff(dir, null)
    expect(d.mode).toBe('full')
    expect(d.reason).toBe('baseline')
    expect(d.lastCommit).toBeNull()
    expect(d.currentCommit).toBe(c1)
  })

  it('outside a git repo → full / no_git', () => {
    const nonRepo = mkdtempSync(path.join(tmpdir(), 'soop-nogit-'))
    try {
      const d = decideSyncFromCommitDiff(nonRepo, metaAt('abc'))
      expect(d.mode).toBe('full')
      expect(d.reason).toBe('no_git')
      expect(d.currentCommit).toBeNull()
    }
    finally {
      rmSync(nonRepo, { recursive: true, force: true })
    }
  })

  it('last == HEAD & clean → noop / head_unchanged_clean', () => {
    const d = decideSyncFromCommitDiff(dir, metaAt(c1))
    expect(d.mode).toBe('noop')
    expect(d.reason).toBe('head_unchanged_clean')
    expect(d.changed).toEqual([])
  })

  it('last == HEAD & branch drift → noop with metaDrift populated', () => {
    // Move to a same-SHA branch (rename)
    g(dir, ['branch', '-m', 'main', 'renamed'])
    const d = decideSyncFromCommitDiff(dir, metaAt(c1, 'main'))
    expect(d.mode).toBe('noop')
    expect(d.metaDrift?.headBranch).toBe('renamed')
  })

  it('last == HEAD & dirty working tree → incremental / head_unchanged_dirty', () => {
    writeFileSync(path.join(dir, 'a.ts'), 'export const a = 2') // modify
    writeFileSync(path.join(dir, 'b.ts'), 'export const b = 1') // untracked
    const d = decideSyncFromCommitDiff(dir, metaAt(c1))
    expect(d.mode).toBe('incremental')
    expect(d.reason).toBe('head_unchanged_dirty')
    expect(d.changed.sort()).toEqual(['a.ts', 'b.ts'])
  })

  it('last == HEAD & stagedOnly ignores unstaged working-tree changes', () => {
    writeFileSync(path.join(dir, 'a.ts'), 'export const a = 2')
    g(dir, ['add', 'a.ts'])
    writeFileSync(path.join(dir, 'b.ts'), 'export const b = 1') // unstaged, ignored
    const d = decideSyncFromCommitDiff(dir, metaAt(c1), { stagedOnly: true })
    expect(d.mode).toBe('incremental')
    expect(d.changed).toEqual(['a.ts'])
  })

  it('linear advance → incremental / linear', () => {
    writeFileSync(path.join(dir, 'a.ts'), 'export const a = 2')
    g(dir, ['add', '.'])
    const c2 = commit(dir, 'c2')

    const d = decideSyncFromCommitDiff(dir, metaAt(c1))
    expect(d.mode).toBe('incremental')
    expect(d.reason).toBe('linear')
    expect(d.lastCommit).toBe(c1)
    expect(d.currentCommit).toBe(c2)
    expect(d.changed).toContain('a.ts')
  })

  it('linear advance with rename → renames map populated', () => {
    // Write a substantial file so git can detect rename via -M
    writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1\n'.repeat(80))
    g(dir, ['add', '.'])
    commit(dir, 'c2-bigfile')
    const c2 = readHeadSha(dir)

    g(dir, ['mv', 'a.ts', 'renamed.ts'])
    g(dir, ['add', '.'])
    commit(dir, 'c3-rename')

    const d = decideSyncFromCommitDiff(dir, metaAt(c2))
    expect(d.mode).toBe('incremental')
    expect(d.renames).toEqual({ 'a.ts': 'renamed.ts' })
    expect(d.changed).toContain('renamed.ts')
  })

  it('diverged (amend) → full / diverged', () => {
    writeFileSync(path.join(dir, 'a.ts'), 'export const a = 2')
    g(dir, ['add', '.'])
    commit(dir, 'c2')
    const oldHead = readHeadSha(dir)

    // Amend overwrites c2 → old SHA is no longer in current history
    execFileSync(resolveGitBinary(), ['commit', '--amend', '-m', 'c2-amended'], { cwd: dir })

    const d = decideSyncFromCommitDiff(dir, metaAt(oldHead))
    expect(d.mode).toBe('full')
    expect(d.reason).toBe('diverged')
  })

  it('over_limit → full with explicit reason', () => {
    // Touch limit+1 .ts files
    for (let i = 0; i < DEFAULT_INCREMENTAL_FILE_LIMIT + 5; i++)
      writeFileSync(path.join(dir, `f${i}.ts`), `export const f${i} = ${i}`)
    g(dir, ['add', '.'])
    const c2 = commit(dir, 'c2-bulk')

    const d = decideSyncFromCommitDiff(dir, metaAt(c1))
    expect(d.mode).toBe('full')
    expect(d.reason).toMatch(/^over_limit_\d+>\d+$/)
    expect(d.currentCommit).toBe(c2)
  })

  it('over_limit with custom fileLimit', () => {
    for (let i = 0; i < 6; i++)
      writeFileSync(path.join(dir, `f${i}.ts`), `export const f${i} = ${i}`)
    g(dir, ['add', '.'])
    commit(dir, 'c2')

    const d = decideSyncFromCommitDiff(dir, metaAt(c1), { fileLimit: 3 })
    expect(d.mode).toBe('full')
    expect(d.reason).toMatch(/^over_limit_\d+>3$/)
  })

  it('nextGitMeta reflects current HEAD for any mode', () => {
    const d = decideSyncFromCommitDiff(dir, metaAt(c1))
    expect(d.nextGitMeta?.headCommit).toBe(c1)
    expect(d.nextGitMeta?.headBranch).toBe('main')
  })
})
