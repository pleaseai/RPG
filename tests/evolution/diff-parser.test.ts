import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DiffParser } from '../../src/encoder/evolution/diff-parser'

describe('diffParser.parseNameStatus', () => {
  const parser = new DiffParser('/tmp/test-repo')

  it('parses added files', () => {
    const result = parser.parseNameStatus('A\tsrc/new-file.ts')
    expect(result).toEqual([{ status: 'A', filePath: 'src/new-file.ts' }])
  })

  it('parses modified files', () => {
    const result = parser.parseNameStatus('M\tsrc/existing.ts')
    expect(result).toEqual([{ status: 'M', filePath: 'src/existing.ts' }])
  })

  it('parses deleted files', () => {
    const result = parser.parseNameStatus('D\tsrc/removed.ts')
    expect(result).toEqual([{ status: 'D', filePath: 'src/removed.ts' }])
  })

  it('parses multiple changes', () => {
    const output = ['A\tsrc/new.ts', 'M\tsrc/changed.ts', 'D\tsrc/removed.ts'].join('\n')

    const result = parser.parseNameStatus(output)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ status: 'A', filePath: 'src/new.ts' })
    expect(result[1]).toEqual({ status: 'M', filePath: 'src/changed.ts' })
    expect(result[2]).toEqual({ status: 'D', filePath: 'src/removed.ts' })
  })

  it('handles rename as delete + add', () => {
    const result = parser.parseNameStatus('R100\tsrc/old.ts\tsrc/new.ts')
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ status: 'D', filePath: 'src/old.ts' })
    expect(result[1]).toEqual({ status: 'A', filePath: 'src/new.ts' })
  })

  it('handles copy as add', () => {
    const result = parser.parseNameStatus('C100\tsrc/original.ts\tsrc/copy.ts')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ status: 'A', filePath: 'src/copy.ts' })
  })

  it('skips empty lines', () => {
    const output = 'A\tsrc/new.ts\n\nM\tsrc/changed.ts\n'
    const result = parser.parseNameStatus(output)
    expect(result).toHaveLength(2)
  })

  it('skips malformed lines', () => {
    const result = parser.parseNameStatus('invalid line')
    expect(result).toHaveLength(0)
  })

  it('handles empty output', () => {
    const result = parser.parseNameStatus('')
    expect(result).toHaveLength(0)
  })
})

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
  it('only parses changed files from diff, not the entire repository', async () => {
    const fixtureRepo = path.resolve(__dirname, '../fixtures/superjson')
    const parser = new DiffParser(fixtureRepo)

    // Use a commit range that modifies a .ts file (5f920b4 modifies src/index.test.ts)
    const result = await parser.parse('5f920b4~1..5f920b4')

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
    const fileChanges = await parser.getFileChanges('5f920b4~1..5f920b4')
    const changedPaths = new Set(fileChanges.map(c => c.filePath))
    for (const fp of allEntityFilePaths) {
      expect(changedPaths.has(fp)).toBe(true)
    }
  })
})
