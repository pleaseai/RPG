import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { decideSyncFromCommitDiff, DEFAULT_INCREMENTAL_FILE_LIMIT } from '@pleaseai/soop-encoder/sync'
import { resolveGitBinary } from '@pleaseai/soop-utils/git-path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

function g(cwd: string, args: string[]): string {
  return execFileSync(resolveGitBinary(), args, { cwd, encoding: 'utf-8' }).trim()
}
function commit(cwd: string, msg: string): string {
  execFileSync(resolveGitBinary(), ['commit', '-m', msg], { cwd, encoding: 'utf-8' })
  return g(cwd, ['rev-parse', 'HEAD'])
}
function setupRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'soop-sync-int-'))
  g(dir, ['init', '-b', 'main'])
  g(dir, ['config', 'user.email', 't@t.com'])
  g(dir, ['config', 'user.name', 't'])
  writeFileSync(path.join(dir, 'index.ts'), 'export const x = 1')
  g(dir, ['add', '.'])
  return dir
}

describe('sync decision — end-to-end scenarios', () => {
  let dir: string
  beforeEach(() => { dir = setupRepo() })
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }) }
    catch { /* best-effort cleanup; OS may race on .git/index unlink */ }
  })

  it('rebase rewrites history → diverged → full', () => {
    const c1 = commit(dir, 'c1')
    writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1')
    g(dir, ['add', '.'])
    commit(dir, 'c2')
    writeFileSync(path.join(dir, 'b.ts'), 'export const b = 1')
    g(dir, ['add', '.'])
    const c3old = commit(dir, 'c3')

    // Rebase squash: c2 + c3 → single commit
    execFileSync(resolveGitBinary(), ['reset', '--soft', c1], { cwd: dir })
    execFileSync(resolveGitBinary(), ['commit', '-m', 'c2+3-squashed'], { cwd: dir })

    // Old c3 SHA is no longer on the history line
    const d = decideSyncFromCommitDiff(dir, { headCommit: c3old })
    expect(d.mode).toBe('full')
    expect(d.reason).toBe('diverged')
  })

  it('amend → diverged → full', () => {
    writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1')
    g(dir, ['add', '.'])
    commit(dir, 'c1')
    const oldHead = g(dir, ['rev-parse', 'HEAD'])
    execFileSync(resolveGitBinary(), ['commit', '--amend', '-m', 'c1-amended'], { cwd: dir })
    const d = decideSyncFromCommitDiff(dir, { headCommit: oldHead })
    expect(d.mode).toBe('full')
    expect(d.reason).toBe('diverged')
  })

  it('staged-only ignores working-tree-only changes', () => {
    const c1 = commit(dir, 'c1')
    writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1')
    g(dir, ['add', 'a.ts']) // staged
    writeFileSync(path.join(dir, 'b.ts'), 'export const b = 1') // unstaged
    const dStaged = decideSyncFromCommitDiff(dir, { headCommit: c1 }, { stagedOnly: true })
    expect(dStaged.changed).toEqual(['a.ts'])

    const dWorking = decideSyncFromCommitDiff(dir, { headCommit: c1 }, { stagedOnly: false })
    expect(dWorking.changed.sort()).toEqual(['a.ts', 'b.ts'])
  })

  it('over-limit safety net triggers in head_unchanged_dirty branch', () => {
    const c1 = commit(dir, 'c1')
    // Touch limit+1 files, all unstaged
    for (let i = 0; i < DEFAULT_INCREMENTAL_FILE_LIMIT + 2; i++)
      writeFileSync(path.join(dir, `f${i}.ts`), `export const f${i} = ${i}`)
    const d = decideSyncFromCommitDiff(dir, { headCommit: c1 })
    expect(d.mode).toBe('full')
    expect(d.reason).toMatch(/^over_limit_\d+>\d+$/)
  })

  it('chains noop → linear → diverged in a single repo lifecycle', () => {
    const c1 = commit(dir, 'c1')
    // 1) noop — last == HEAD & clean
    let d = decideSyncFromCommitDiff(dir, { headCommit: c1 })
    expect(d.mode).toBe('noop')
    expect(d.reason).toBe('head_unchanged_clean')

    // 2) linear — commit one file, last still c1
    writeFileSync(path.join(dir, 'a.ts'), 'a')
    g(dir, ['add', '.'])
    const c2 = commit(dir, 'c2')
    d = decideSyncFromCommitDiff(dir, { headCommit: c1 })
    expect(d.mode).toBe('incremental')
    expect(d.reason).toBe('linear')
    expect(d.changed).toContain('a.ts')

    // 3) diverged — reset --hard back to c1, now c2 SHA isn't on history
    execFileSync(resolveGitBinary(), ['reset', '--hard', c1], { cwd: dir })
    d = decideSyncFromCommitDiff(dir, { headCommit: c2 })
    expect(d.mode).toBe('full')
    expect(d.reason).toBe('diverged')
  })

  it('linear advance picks up multiple intermediate commits', () => {
    const c1 = commit(dir, 'c1')
    writeFileSync(path.join(dir, 'a.ts'), 'a')
    g(dir, ['add', '.'])
    commit(dir, 'c2')
    writeFileSync(path.join(dir, 'b.ts'), 'b')
    g(dir, ['add', '.'])
    commit(dir, 'c3')

    const d = decideSyncFromCommitDiff(dir, { headCommit: c1 })
    expect(d.mode).toBe('incremental')
    expect(d.reason).toBe('linear')
    expect(d.changed.sort()).toEqual(['a.ts', 'b.ts'])
  })
})
