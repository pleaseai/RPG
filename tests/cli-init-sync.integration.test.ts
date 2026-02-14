import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { RepositoryPlanningGraph } from '@pleaseai/rpg-graph'
import { getHeadCommitSha } from '@pleaseai/rpg-utils/git-helpers'
import { resolveGitBinary } from '@pleaseai/rpg-utils/git-path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installHooks } from '../packages/cli/src/commands/hooks'
import { ensureGitignoreEntry, generateCIWorkflow, registerInitCommand } from '../packages/cli/src/commands/init'
import { registerSyncCommand } from '../packages/cli/src/commands/sync'

function git(cwd: string, args: string[]): string {
  return execFileSync(resolveGitBinary(), args, {
    cwd,
    encoding: 'utf-8',
    timeout: 10_000,
  }).trim()
}

describe('ensureGitignoreEntry', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'rpg-gitignore-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should create .gitignore when it does not exist', async () => {
    await ensureGitignoreEntry(tempDir, '.rpg/local/')

    const content = await readFile(path.join(tempDir, '.gitignore'), 'utf-8')
    expect(content).toContain('.rpg/local/')
    expect(content).toContain('# RPG local data')
  })

  it('should skip if pattern already exists in .gitignore', async () => {
    await writeFile(
      path.join(tempDir, '.gitignore'),
      '# existing\n.rpg/local/\n',
    )

    await ensureGitignoreEntry(tempDir, '.rpg/local/')

    const content = await readFile(path.join(tempDir, '.gitignore'), 'utf-8')
    // Should appear exactly once
    const matches = content.match(/\.rpg\/local\//g)
    expect(matches).toHaveLength(1)
  })

  it('should append section when .gitignore exists and ends with newline', async () => {
    await writeFile(
      path.join(tempDir, '.gitignore'),
      'node_modules/\ndist/\n',
    )

    await ensureGitignoreEntry(tempDir, '.rpg/local/')

    const content = await readFile(path.join(tempDir, '.gitignore'), 'utf-8')
    expect(content).toContain('node_modules/')
    expect(content).toContain('.rpg/local/')
    expect(content).toContain('# RPG local data')
  })

  it('should add separator when .gitignore does not end with newline', async () => {
    await writeFile(
      path.join(tempDir, '.gitignore'),
      'node_modules/',
    )

    await ensureGitignoreEntry(tempDir, '.rpg/local/')

    const content = await readFile(path.join(tempDir, '.gitignore'), 'utf-8')
    expect(content).toContain('node_modules/')
    expect(content).toContain('.rpg/local/')
    // Should have a newline separator before the RPG section
    expect(content).not.toMatch(/node_modules\/# RPG/)
  })
})

describe('generateCIWorkflow', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'rpg-ci-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should generate workflow file from template', async () => {
    await generateCIWorkflow(tempDir)

    const workflowPath = path.join(tempDir, '.github', 'workflows', 'rpg-encode.yml')
    expect(existsSync(workflowPath)).toBe(true)

    const content = await readFile(workflowPath, 'utf-8')
    expect(content).toContain('name: RPG Encode')
    expect(content).toContain('rpg encode')
    expect(content).toContain('rpg evolve')
    expect(content).toContain('[skip ci]')
  })

  it('should skip if workflow file already exists', async () => {
    const workflowDir = path.join(tempDir, '.github', 'workflows')
    mkdirSync(workflowDir, { recursive: true })
    await writeFile(
      path.join(workflowDir, 'rpg-encode.yml'),
      'existing content',
    )

    await generateCIWorkflow(tempDir)

    const content = await readFile(
      path.join(workflowDir, 'rpg-encode.yml'),
      'utf-8',
    )
    expect(content).toBe('existing content')
  })
})

describe('rpg init command', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'rpg-init-'))
    git(tempDir, ['init', '-b', 'main'])
    git(tempDir, ['config', 'user.email', 'test@test.com'])
    git(tempDir, ['config', 'user.name', 'Test'])
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should create .rpg/config.json and local directories', async () => {
    const program = new Command()
    program.exitOverride()
    registerInitCommand(program)
    await program.parseAsync(['node', 'rpg', 'init', tempDir])

    // config.json created with default settings
    const configPath = path.join(tempDir, '.rpg', 'config.json')
    expect(existsSync(configPath)).toBe(true)
    const config = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(config.include).toEqual(['**/*.ts', '**/*.js', '**/*.py', '**/*.rs', '**/*.go', '**/*.java'])
    expect(config.exclude).toEqual(['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'])

    // local/vectors/ directory created
    expect(existsSync(path.join(tempDir, '.rpg', 'local', 'vectors'))).toBe(true)

    // .gitignore updated
    const gitignore = await readFile(path.join(tempDir, '.gitignore'), 'utf-8')
    expect(gitignore).toContain('.rpg/local/')
  })

  it('should skip config creation if .rpg/config.json already exists', async () => {
    // Pre-create config
    const rpgDir = path.join(tempDir, '.rpg')
    mkdirSync(rpgDir, { recursive: true })
    await writeFile(
      path.join(rpgDir, 'config.json'),
      JSON.stringify({ custom: true }, null, 2),
    )

    const program = new Command()
    program.exitOverride()
    registerInitCommand(program)
    await program.parseAsync(['node', 'rpg', 'init', tempDir])

    // Original config preserved
    const config = JSON.parse(await readFile(path.join(rpgDir, 'config.json'), 'utf-8'))
    expect(config.custom).toBe(true)
    expect(config.include).toBeUndefined()
  })

  it('should install hooks with --hooks flag', async () => {
    const program = new Command()
    program.exitOverride()
    registerInitCommand(program)
    await program.parseAsync(['node', 'rpg', 'init', tempDir, '--hooks'])

    const postMerge = path.join(tempDir, '.git', 'hooks', 'post-merge')
    const postCheckout = path.join(tempDir, '.git', 'hooks', 'post-checkout')
    expect(existsSync(postMerge)).toBe(true)
    expect(existsSync(postCheckout)).toBe(true)

    // Hooks should be executable
    const stat = statSync(postMerge)
    expect(stat.mode & 0o111).toBeGreaterThan(0)

    // Hooks should contain rpg sync
    const content = await readFile(postMerge, 'utf-8')
    expect(content).toContain('rpg sync')
  })

  it('should generate CI workflow with --ci flag', async () => {
    const program = new Command()
    program.exitOverride()
    registerInitCommand(program)
    await program.parseAsync(['node', 'rpg', 'init', tempDir, '--ci'])

    const workflowPath = path.join(tempDir, '.github', 'workflows', 'rpg-encode.yml')
    expect(existsSync(workflowPath)).toBe(true)

    const content = await readFile(workflowPath, 'utf-8')
    expect(content).toContain('name: RPG Encode')
  })
})

describe('installHooks', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'rpg-hooks-'))
    git(tempDir, ['init', '-b', 'main'])
    git(tempDir, ['config', 'user.email', 'test@test.com'])
    git(tempDir, ['config', 'user.name', 'Test'])
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should install post-merge and post-checkout hooks', async () => {
    await installHooks(tempDir)
    expect(existsSync(path.join(tempDir, '.git', 'hooks', 'post-merge'))).toBe(true)
    expect(existsSync(path.join(tempDir, '.git', 'hooks', 'post-checkout'))).toBe(true)
  })

  it('should not overwrite existing hooks', async () => {
    const hookPath = path.join(tempDir, '.git', 'hooks', 'post-merge')
    mkdirSync(path.dirname(hookPath), { recursive: true })
    await writeFile(hookPath, '#!/bin/sh\necho existing')

    await installHooks(tempDir)

    const content = await readFile(hookPath, 'utf-8')
    expect(content).toBe('#!/bin/sh\necho existing')
  })

  it('should do nothing for non-git directories', async () => {
    const nonGitDir = mkdtempSync(path.join(tmpdir(), 'rpg-no-git-'))
    try {
      await installHooks(nonGitDir)
      // Should not throw, just log error and return
      expect(existsSync(path.join(nonGitDir, '.git', 'hooks'))).toBe(false)
    }
    finally {
      rmSync(nonGitDir, { recursive: true, force: true })
    }
  })

  it('should create .git/hooks/ directory if it does not exist', async () => {
    // Remove existing hooks dir if present
    const hooksDir = path.join(tempDir, '.git', 'hooks')
    if (existsSync(hooksDir)) {
      rmSync(hooksDir, { recursive: true, force: true })
    }

    await installHooks(tempDir)

    expect(existsSync(path.join(hooksDir, 'post-merge'))).toBe(true)
    expect(existsSync(path.join(hooksDir, 'post-checkout'))).toBe(true)
  })
})

describe('rpg sync command', () => {
  let tempDir: string
  let originalCwd: () => string

  beforeEach(async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'rpg-sync-'))
    git(tempDir, ['init', '-b', 'main'])
    git(tempDir, ['config', 'user.email', 'test@test.com'])
    git(tempDir, ['config', 'user.name', 'Test'])

    await writeFile(path.join(tempDir, 'hello.ts'), 'export const x = 1')
    git(tempDir, ['add', '.'])
    git(tempDir, ['commit', '-m', 'initial'])

    // Mock process.cwd since sync uses it
    originalCwd = process.cwd
    process.cwd = () => tempDir
  })

  afterEach(() => {
    process.cwd = originalCwd
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should copy canonical graph to local on default branch', async () => {
    // Set up canonical graph
    const rpg = await RepositoryPlanningGraph.create({
      name: 'test',
      rootPath: tempDir,
      github: { owner: '', repo: 'test', commit: getHeadCommitSha(tempDir) },
    })
    const rpgDir = path.join(tempDir, '.rpg')
    mkdirSync(rpgDir, { recursive: true })
    await writeFile(path.join(rpgDir, 'graph.json'), await rpg.toJSON())

    // Run sync via Commander
    const program = new Command()
    program.exitOverride()
    registerSyncCommand(program)
    await program.parseAsync(['node', 'rpg', 'sync'])

    // Verify local graph was created
    const localGraphPath = path.join(rpgDir, 'local', 'graph.json')
    expect(existsSync(localGraphPath)).toBe(true)

    // Verify local graph matches canonical
    const localJson = await readFile(localGraphPath, 'utf-8')
    const canonicalJson = await readFile(path.join(rpgDir, 'graph.json'), 'utf-8')
    expect(localJson).toBe(canonicalJson)

    // Verify state.json was created
    const statePath = path.join(rpgDir, 'local', 'state.json')
    expect(existsSync(statePath)).toBe(true)

    const state = JSON.parse(await readFile(statePath, 'utf-8'))
    expect(state.baseCommit).toMatch(/^[0-9a-f]{40}$/)
    expect(state.branch).toBe('main')
    expect(state.lastSync).toBeDefined()
  })

  it('should exit with error when canonical graph is missing', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)

    try {
      const program = new Command()
      program.exitOverride()
      registerSyncCommand(program)

      await expect(
        program.parseAsync(['node', 'rpg', 'sync']),
      ).rejects.toThrow('process.exit called')

      expect(exitSpy).toHaveBeenCalledWith(1)
    }
    finally {
      exitSpy.mockRestore()
    }
  })

  it('should write correct state after sync', async () => {
    const headSha = getHeadCommitSha(tempDir)
    const rpg = await RepositoryPlanningGraph.create({
      name: 'test',
      rootPath: tempDir,
      github: { owner: '', repo: 'test', commit: headSha },
    })
    const rpgDir = path.join(tempDir, '.rpg')
    mkdirSync(rpgDir, { recursive: true })
    await writeFile(path.join(rpgDir, 'graph.json'), await rpg.toJSON())

    const program = new Command()
    program.exitOverride()
    registerSyncCommand(program)
    await program.parseAsync(['node', 'rpg', 'sync'])

    const state = JSON.parse(
      await readFile(path.join(rpgDir, 'local', 'state.json'), 'utf-8'),
    )
    expect(state.baseCommit).toBe(headSha)
    expect(state.branch).toBe('main')
    // lastSync should be a valid ISO date
    expect(new Date(state.lastSync).getTime()).not.toBeNaN()
  })

  it('should create local/vectors directory', async () => {
    const rpg = await RepositoryPlanningGraph.create({
      name: 'test',
      rootPath: tempDir,
      github: { owner: '', repo: 'test', commit: getHeadCommitSha(tempDir) },
    })
    const rpgDir = path.join(tempDir, '.rpg')
    mkdirSync(rpgDir, { recursive: true })
    await writeFile(path.join(rpgDir, 'graph.json'), await rpg.toJSON())

    const program = new Command()
    program.exitOverride()
    registerSyncCommand(program)
    await program.parseAsync(['node', 'rpg', 'sync'])

    expect(existsSync(path.join(rpgDir, 'local', 'vectors'))).toBe(true)
  })

  it('should re-copy canonical when --force is used', async () => {
    const headSha = getHeadCommitSha(tempDir)
    const rpg = await RepositoryPlanningGraph.create({
      name: 'test',
      rootPath: tempDir,
      github: { owner: '', repo: 'test', commit: headSha },
    })
    const rpgDir = path.join(tempDir, '.rpg')
    const localDir = path.join(rpgDir, 'local')
    mkdirSync(localDir, { recursive: true })
    await writeFile(path.join(rpgDir, 'graph.json'), await rpg.toJSON())

    // Pre-create local graph with different content
    await writeFile(path.join(localDir, 'graph.json'), '{"old": true}')
    // Pre-create local state
    await writeFile(
      path.join(localDir, 'state.json'),
      JSON.stringify({ baseCommit: 'old', branch: 'main', lastSync: '2020-01-01T00:00:00Z' }),
    )

    const program = new Command()
    program.exitOverride()
    registerSyncCommand(program)
    await program.parseAsync(['node', 'rpg', 'sync', '--force'])

    // Local graph should match canonical (overwritten)
    const localJson = await readFile(path.join(localDir, 'graph.json'), 'utf-8')
    const canonicalJson = await readFile(path.join(rpgDir, 'graph.json'), 'utf-8')
    expect(localJson).toBe(canonicalJson)

    // State should be updated
    const state = JSON.parse(await readFile(path.join(localDir, 'state.json'), 'utf-8'))
    expect(state.baseCommit).toBe(headSha)
    expect(state.lastSync).not.toBe('2020-01-01T00:00:00Z')
  })
})
