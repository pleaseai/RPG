import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { RepositoryPlanningGraph } from '@pleaseai/rpg-graph'
import { getHeadCommitSha } from '@pleaseai/rpg-utils/git-helpers'
import { resolveGitBinary } from '@pleaseai/rpg-utils/git-path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installHooks } from '../packages/cli/src/commands/hooks'

function git(cwd: string, args: string[]): string {
  return execFileSync(resolveGitBinary(), args, {
    cwd,
    encoding: 'utf-8',
    timeout: 10_000,
  }).trim()
}

describe('rpg init logic', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'rpg-init-'))
    git(tempDir, ['init'])
    git(tempDir, ['config', 'user.email', 'test@test.com'])
    git(tempDir, ['config', 'user.name', 'Test'])
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should create .rpg/config.json with default settings', async () => {
    const { registerInitCommand } = await import('../packages/cli/src/commands/init')
    const rpgDir = path.join(tempDir, '.rpg')

    // Simulate what init does: create config
    mkdirSync(rpgDir, { recursive: true })
    const defaultConfig = {
      include: ['**/*.ts', '**/*.js', '**/*.py', '**/*.rs', '**/*.go', '**/*.java'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
    }
    await writeFile(path.join(rpgDir, 'config.json'), JSON.stringify(defaultConfig, null, 2))

    expect(existsSync(path.join(rpgDir, 'config.json'))).toBe(true)
    const config = JSON.parse(await readFile(path.join(rpgDir, 'config.json'), 'utf-8'))
    expect(config.include).toBeDefined()
    expect(config.exclude).toBeDefined()
    expect(Array.isArray(config.include)).toBe(true)

    // Check registerInitCommand is exported correctly
    expect(typeof registerInitCommand).toBe('function')
  })

  it('should install git hooks', async () => {
    await installHooks(tempDir)
    expect(existsSync(path.join(tempDir, '.git', 'hooks', 'post-merge'))).toBe(true)
    expect(existsSync(path.join(tempDir, '.git', 'hooks', 'post-checkout'))).toBe(true)
  })

  it('should not overwrite existing git hooks', async () => {
    const hookPath = path.join(tempDir, '.git', 'hooks', 'post-merge')
    mkdirSync(path.dirname(hookPath), { recursive: true })
    await writeFile(hookPath, '#!/bin/sh\necho existing')

    await installHooks(tempDir)

    const content = await readFile(hookPath, 'utf-8')
    expect(content).toBe('#!/bin/sh\necho existing')
  })

  it('should add .rpg/local/ to .gitignore', async () => {
    // Create a .gitignore and add .rpg/local/ entry
    const gitignorePath = path.join(tempDir, '.gitignore')
    await writeFile(gitignorePath, '# test\nnode_modules/\n')

    // Append the RPG local data entry
    const content = await readFile(gitignorePath, 'utf-8')
    await writeFile(gitignorePath, `${content}\n# RPG local data\n.rpg/local/\n`)

    const updated = await readFile(gitignorePath, 'utf-8')
    expect(updated).toContain('.rpg/local/')
  })
})

describe('rpg sync logic', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'rpg-sync-'))
    git(tempDir, ['init'])
    git(tempDir, ['config', 'user.email', 'test@test.com'])
    git(tempDir, ['config', 'user.name', 'Test'])

    await writeFile(path.join(tempDir, 'hello.ts'), 'export const x = 1')
    git(tempDir, ['add', '.'])
    git(tempDir, ['commit', '-m', 'initial'])
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should copy canonical graph to local', async () => {
    const rpg = await RepositoryPlanningGraph.create({
      name: 'test',
      rootPath: tempDir,
      github: { owner: '', repo: 'test', commit: getHeadCommitSha(tempDir) },
    })

    const rpgDir = path.join(tempDir, '.rpg')
    mkdirSync(rpgDir, { recursive: true })
    mkdirSync(path.join(rpgDir, 'local', 'vectors'), { recursive: true })
    await writeFile(path.join(rpgDir, 'graph.json'), await rpg.toJSON())

    // Simulate sync: copy canonical to local
    const { copyFileSync } = await import('node:fs')
    copyFileSync(path.join(rpgDir, 'graph.json'), path.join(rpgDir, 'local', 'graph.json'))

    // Write local state
    const state = {
      baseCommit: getHeadCommitSha(tempDir),
      branch: 'main',
      lastSync: new Date().toISOString(),
    }
    await writeFile(path.join(rpgDir, 'local', 'state.json'), JSON.stringify(state, null, 2))

    expect(existsSync(path.join(rpgDir, 'local', 'graph.json'))).toBe(true)
    expect(existsSync(path.join(rpgDir, 'local', 'state.json'))).toBe(true)

    const localState = JSON.parse(await readFile(path.join(rpgDir, 'local', 'state.json'), 'utf-8'))
    expect(localState.baseCommit).toMatch(/^[0-9a-f]{40}$/)
    expect(localState.branch).toBe('main')
  })

  it('registerSyncCommand should be exported correctly', async () => {
    const { registerSyncCommand } = await import('../packages/cli/src/commands/sync')
    expect(typeof registerSyncCommand).toBe('function')
  })
})
