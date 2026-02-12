import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { DiffParser } from '@pleaseai/rpg-encoder/evolution/diff-parser'
import { resolveGitBinary } from '@pleaseai/rpg-utils/git-path'
import { describe, expect, it } from 'vitest'

function hasGitAncestor(repoPath: string, ref: string): boolean {
  let git: string
  try {
    git = resolveGitBinary()
  }
  catch {
    return false
  }
  try {
    execFileSync(git, ['rev-parse', '--verify', ref], { cwd: repoPath, stdio: 'pipe' })
    return true
  }
  catch {
    return false
  }
}

describe('diffParser.extractEntitiesFromRevision', () => {
  it('extracts entities from a TypeScript file at a revision', async () => {
    const fixtureRepo = path.resolve(__dirname, '../fixtures/superjson')
    const parser = new DiffParser(fixtureRepo)

    // Use a known commit
    const entities = await parser.extractEntitiesFromRevision('HEAD', 'src/index.ts')

    expect(entities.length).toBeGreaterThan(0)

    // Should include file-level entity
    const fileEntity = entities.find(e => e.entityType === 'file')
    expect(fileEntity).toBeDefined()
    expect(fileEntity?.filePath).toBe('src/index.ts')

    // All entities should have the correct filePath
    for (const entity of entities) {
      expect(entity.filePath).toBe('src/index.ts')
      expect(entity.id).toContain('src/index.ts')
    }
  })

  it('returns empty array for non-existent file', async () => {
    const fixtureRepo = path.resolve(__dirname, '../fixtures/superjson')
    const parser = new DiffParser(fixtureRepo)

    const entities = await parser.extractEntitiesFromRevision('HEAD', 'does-not-exist.ts')
    expect(entities).toEqual([])
  })

  it('returns empty array for unsupported file type', async () => {
    const fixtureRepo = path.resolve(__dirname, '../fixtures/superjson')
    const parser = new DiffParser(fixtureRepo)

    const entities = await parser.extractEntitiesFromRevision('HEAD', 'package.json')
    expect(entities).toEqual([])
  })
})

describe('diffParser AC-1: only process changed files', () => {
  // 5f920b4 modifies src/index.test.ts — a known commit with .ts changes
  const COMMIT_WITH_TS_CHANGE = '5f920b4'
  const fixtureRepo = path.resolve(__dirname, '../fixtures/superjson')

  it.skipIf(!hasGitAncestor(fixtureRepo, `${COMMIT_WITH_TS_CHANGE}~1`))(
    'only parses changed files from diff, not the entire repository',
    async () => {
      const parser = new DiffParser(fixtureRepo)
      const commitRange = `${COMMIT_WITH_TS_CHANGE}~1..${COMMIT_WITH_TS_CHANGE}`

      const result = await parser.parse(commitRange)

      // The fixture has many files, but diff should only process changed ones
      const allEntityFilePaths = new Set([
        ...result.insertions.map(e => e.filePath),
        ...result.deletions.map(e => e.filePath),
        ...result.modifications.map(m => m.new.filePath),
      ])

      // Should have processed only the changed .ts file(s)
      expect(allEntityFilePaths.size).toBeGreaterThan(0)
      expect(allEntityFilePaths.size).toBeLessThanOrEqual(5)

      // Verify: all processed files should be from the git diff
      const fileChanges = await parser.getFileChanges(commitRange)
      const changedPaths = new Set(fileChanges.map(c => c.filePath))
      for (const fp of allEntityFilePaths) {
        expect(changedPaths.has(fp)).toBe(true)
      }
    },
  )
})
