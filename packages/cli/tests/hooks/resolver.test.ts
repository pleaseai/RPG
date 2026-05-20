import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveGitBinary } from '@pleaseai/soop-utils/git-path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readCoreHooksPath, resolveGitHooksDir } from '../../src/hooks/resolver'

function g(cwd: string, args: string[]): void {
  execFileSync(resolveGitBinary(), args, { cwd, encoding: 'utf-8' })
}

describe('resolveGitHooksDir', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'soop-resolver-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('returns null for empty / non-existent path', () => {
    expect(resolveGitHooksDir('')).toBeNull()
    expect(resolveGitHooksDir('/nonexistent/path')).toBeNull()
  })

  it('returns null when no .git marker exists', () => {
    expect(resolveGitHooksDir(dir)).toBeNull()
  })

  it('returns .git/hooks for a plain repo', () => {
    g(dir, ['init', '-b', 'main'])
    expect(resolveGitHooksDir(dir)).toBe(path.join(dir, '.git', 'hooks'))
  })

  it('honors core.hooksPath when set (husky-style)', () => {
    g(dir, ['init', '-b', 'main'])
    mkdirSync(path.join(dir, '.husky', '_'), { recursive: true })
    g(dir, ['config', 'core.hooksPath', '.husky/_'])
    expect(resolveGitHooksDir(dir)).toBe(path.resolve(dir, '.husky/_'))
  })

  it('honors absolute core.hooksPath', () => {
    g(dir, ['init', '-b', 'main'])
    const absHooks = path.join(dir, 'abs-hooks')
    mkdirSync(absHooks, { recursive: true })
    g(dir, ['config', 'core.hooksPath', absHooks])
    expect(resolveGitHooksDir(dir)).toBe(absHooks)
  })

  it('routes worktree (.git is a file, parent = worktrees) to main repo hooks', () => {
    g(dir, ['init', '-b', 'main'])
    execFileSync(resolveGitBinary(), ['commit', '--allow-empty', '-m', 'init'], { cwd: dir })
    execFileSync(resolveGitBinary(), ['config', 'user.email', 't@t.com'], { cwd: dir })
    execFileSync(resolveGitBinary(), ['config', 'user.name', 't'], { cwd: dir })
    const worktreeDir = path.join(dir, '..', `soop-wt-${path.basename(dir)}`)
    try {
      // Use a fresh branch so it doesn't collide with the main checkout
      execFileSync(resolveGitBinary(), ['worktree', 'add', '-b', 'wt-branch', worktreeDir], { cwd: dir })
      // The worktree's .git is a file with `gitdir: <main>/.git/worktrees/<name>`
      const resolved = resolveGitHooksDir(worktreeDir)
      // Should be the MAIN repo's .git/hooks, NOT the worktree's gitdir.
      // Normalize both sides through realpathSync to handle macOS /var → /private/var.
      expect(realpathSync(resolved!)).toBe(realpathSync(path.join(dir, '.git', 'hooks')))
    }
    finally {
      rmSync(worktreeDir, { recursive: true, force: true })
    }
  })

  it('routes --separate-git-dir (.git is a file, parent ≠ worktrees) to gitdir/hooks', () => {
    // Manually construct a `.git` file shape simulating --separate-git-dir
    const gitDirReal = path.join(dir, 'real-gitdir')
    mkdirSync(gitDirReal, { recursive: true })
    writeFileSync(path.join(dir, '.git'), `gitdir: ${gitDirReal}\n`)
    expect(resolveGitHooksDir(dir)).toBe(path.join(gitDirReal, 'hooks'))
  })

  it('returns null for malformed .git file (no `gitdir:` prefix)', () => {
    writeFileSync(path.join(dir, '.git'), 'malformed content\n')
    expect(resolveGitHooksDir(dir)).toBeNull()
  })
})

describe('readCoreHooksPath', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'soop-cphp-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('returns null when not in a git repo', () => {
    expect(readCoreHooksPath(dir)).toBeNull()
  })

  it('returns null when core.hooksPath is unset', () => {
    g(dir, ['init', '-b', 'main'])
    expect(readCoreHooksPath(dir)).toBeNull()
  })

  it('resolves a relative core.hooksPath against project root', () => {
    g(dir, ['init', '-b', 'main'])
    g(dir, ['config', 'core.hooksPath', '.husky/_'])
    expect(readCoreHooksPath(dir)).toBe(path.resolve(dir, '.husky/_'))
  })
})
