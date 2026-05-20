import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveGitBinary } from '@pleaseai/soop-utils/git-path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readHead } from '../../src/git/read-head'

function git(cwd: string, args: string[]): string {
  return execFileSync(resolveGitBinary(), args, {
    cwd,
    encoding: 'utf-8',
    timeout: 10_000,
  }).trim()
}

function setupRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'soop-readhead-'))
  git(dir, ['init', '-b', 'main'])
  git(dir, ['config', 'user.email', 't@t.com'])
  git(dir, ['config', 'user.name', 'Test'])
  return dir
}

describe('readHead', () => {
  let dir: string

  beforeEach(() => {
    dir = setupRepo()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns null for empty / nullish input', () => {
    expect(readHead('')).toBeNull()
    expect(readHead(null)).toBeNull()
    expect(readHead(undefined)).toBeNull()
  })

  it('returns null for non-existent directory', () => {
    expect(readHead('/nonexistent/path/that/should/not/exist')).toBeNull()
  })

  it('returns null for non-git directory', () => {
    const noGitDir = mkdtempSync(path.join(tmpdir(), 'soop-nogit-'))
    try {
      expect(readHead(noGitDir)).toBeNull()
    }
    finally {
      rmSync(noGitDir, { recursive: true, force: true })
    }
  })

  it('returns null for unborn HEAD (init only, no commits)', () => {
    expect(readHead(dir)).toBeNull()
  })

  it('returns full HEAD info for a healthy repo on a branch', () => {
    execFileSync(resolveGitBinary(), ['commit', '--allow-empty', '-m', 'init'], { cwd: dir })
    const head = readHead(dir)
    expect(head).not.toBeNull()
    expect(head!.headCommit).toMatch(/^[0-9a-f]{40}$/)
    expect(head!.headShort).toMatch(/^[0-9a-f]{7,40}$/)
    expect(head!.headBranch).toBe('main')
    expect(head!.headTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('returns null headBranch on detached HEAD', () => {
    execFileSync(resolveGitBinary(), ['commit', '--allow-empty', '-m', 'init'], { cwd: dir })
    const sha = git(dir, ['rev-parse', 'HEAD'])
    git(dir, ['checkout', '--detach', sha])
    const head = readHead(dir)
    expect(head).not.toBeNull()
    expect(head!.headCommit).toBe(sha)
    expect(head!.headBranch).toBeNull()
  })

  it('returns null if path is a file rather than a directory', () => {
    execFileSync(resolveGitBinary(), ['commit', '--allow-empty', '-m', 'init'], { cwd: dir })
    // Pass a path to a file inside the repo
    const filePath = path.join(dir, 'foo.txt')
    execFileSync('touch', [filePath])
    expect(readHead(filePath)).toBeNull()
  })
})
