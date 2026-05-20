import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveGitBinary } from '@pleaseai/soop-utils/git-path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  changedFilesBetween,
  mergeBase,
  stagedChanges,
  workingTreeChanges,
} from '../../src/git/diff'

function g(cwd: string, args: string[]): string {
  return execFileSync(resolveGitBinary(), args, { cwd, encoding: 'utf-8' }).trim()
}

function commit(cwd: string, msg: string): string {
  execFileSync(resolveGitBinary(), ['commit', '-m', msg], { cwd, encoding: 'utf-8' })
  return g(cwd, ['rev-parse', 'HEAD'])
}

function setupRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'soop-diff-'))
  g(dir, ['init', '-b', 'main'])
  g(dir, ['config', 'user.email', 't@t.com'])
  g(dir, ['config', 'user.name', 'Test'])
  return dir
}

describe('diff helpers — silent-fail behaviour', () => {
  it('returns empty for nullish / non-existent / non-repo input', () => {
    expect(stagedChanges('')).toEqual({ modified: [], renames: {} })
    expect(stagedChanges(null)).toEqual({ modified: [], renames: {} })
    expect(stagedChanges('/nonexistent/path')).toEqual({ modified: [], renames: {} })
    expect(workingTreeChanges('/nonexistent/path')).toEqual({ modified: [], renames: {} })
    expect(changedFilesBetween('/nonexistent/path', 'a', 'b')).toEqual({ modified: [], renames: {} })
    expect(mergeBase('/nonexistent/path', 'a', 'b')).toBeNull()

    const nonRepoDir = mkdtempSync(path.join(tmpdir(), 'soop-nonrepo-'))
    try {
      // No `.git` — these all return empty
      expect(stagedChanges(nonRepoDir)).toEqual({ modified: [], renames: {} })
      expect(workingTreeChanges(nonRepoDir)).toEqual({ modified: [], renames: {} })
      expect(mergeBase(nonRepoDir, 'HEAD', 'HEAD')).toBeNull()
    }
    finally {
      rmSync(nonRepoDir, { recursive: true, force: true })
    }
  })

  it('returns null mergeBase when refs are missing', () => {
    expect(mergeBase('/nonexistent', null, null)).toBeNull()
    expect(mergeBase('/nonexistent', '', '')).toBeNull()
  })
})

describe('stagedChanges', () => {
  let dir: string
  beforeEach(() => { dir = setupRepo() })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('detects unborn-branch staged file via fallback path', () => {
    writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1')
    g(dir, ['add', 'a.ts'])
    const result = stagedChanges(dir)
    expect(result.modified).toContain('a.ts')
  })

  it('returns staged but not working-tree-only changes', () => {
    writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1')
    g(dir, ['add', '.'])
    commit(dir, 'init')

    // Stage one file, modify another but do not stage
    writeFileSync(path.join(dir, 'a.ts'), 'export const a = 2')
    g(dir, ['add', 'a.ts'])
    writeFileSync(path.join(dir, 'b.ts'), 'export const b = 1')

    const result = stagedChanges(dir)
    expect(result.modified).toEqual(['a.ts'])
  })
})

describe('workingTreeChanges', () => {
  let dir: string
  beforeEach(() => { dir = setupRepo() })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('captures tracked modifications + untracked when enabled', () => {
    writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1')
    g(dir, ['add', '.'])
    commit(dir, 'init')

    writeFileSync(path.join(dir, 'a.ts'), 'export const a = 2') // tracked modify
    writeFileSync(path.join(dir, 'b.ts'), 'export const b = 1') // untracked add

    const result = workingTreeChanges(dir)
    expect(result.modified.sort()).toEqual(['a.ts', 'b.ts'])
  })

  it('excludes untracked when includeUntracked=false', () => {
    writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1')
    g(dir, ['add', '.'])
    commit(dir, 'init')

    writeFileSync(path.join(dir, 'a.ts'), 'export const a = 2')
    writeFileSync(path.join(dir, 'untracked.ts'), 'export const u = 1')

    const result = workingTreeChanges(dir, { includeUntracked: false })
    expect(result.modified).toEqual(['a.ts'])
  })

  it('captures renames via -M with similarity score', () => {
    writeFileSync(path.join(dir, 'old.ts'), 'export const x = 1\n'.repeat(50))
    g(dir, ['add', '.'])
    commit(dir, 'init')

    g(dir, ['mv', 'old.ts', 'new.ts'])
    const result = workingTreeChanges(dir, { includeUntracked: false })
    expect(result.renames).toEqual({ 'old.ts': 'new.ts' })
    expect(result.modified).toContain('new.ts')
  })
})

describe('changedFilesBetween + mergeBase', () => {
  let dir: string
  beforeEach(() => { dir = setupRepo() })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('returns diff between two commits', () => {
    writeFileSync(path.join(dir, 'a.ts'), 'v1')
    g(dir, ['add', '.'])
    const c1 = commit(dir, 'c1')

    writeFileSync(path.join(dir, 'a.ts'), 'v2')
    writeFileSync(path.join(dir, 'b.ts'), 'new')
    g(dir, ['add', '.'])
    const c2 = commit(dir, 'c2')

    const result = changedFilesBetween(dir, c1, c2)
    expect(result.modified.sort()).toEqual(['a.ts', 'b.ts'])
  })

  it('mergeBase returns the common ancestor for linear advance', () => {
    writeFileSync(path.join(dir, 'a.ts'), 'v1')
    g(dir, ['add', '.'])
    const c1 = commit(dir, 'c1')

    writeFileSync(path.join(dir, 'a.ts'), 'v2')
    g(dir, ['add', '.'])
    commit(dir, 'c2')

    // mergeBase(c1, HEAD) === c1 because c1 is an ancestor of HEAD
    expect(mergeBase(dir, c1, 'HEAD')).toBe(c1)
  })

  it('mergeBase identifies divergence after history rewrite (amend)', () => {
    writeFileSync(path.join(dir, 'a.ts'), 'v1')
    g(dir, ['add', '.'])
    const c1 = commit(dir, 'c1')

    writeFileSync(path.join(dir, 'a.ts'), 'v2')
    g(dir, ['add', '.'])
    commit(dir, 'c2')

    // Amend overwrites c2 — old c2 SHA is no longer in current history.
    const oldHead = g(dir, ['rev-parse', 'HEAD'])
    execFileSync(resolveGitBinary(), ['commit', '--amend', '-m', 'c2-amended'], { cwd: dir })
    const newHead = g(dir, ['rev-parse', 'HEAD'])
    expect(newHead).not.toBe(oldHead)

    // The amended HEAD's parent is c1; merge-base(oldHead, newHead) is c1, not oldHead.
    expect(mergeBase(dir, oldHead, newHead)).toBe(c1)
  })
})
