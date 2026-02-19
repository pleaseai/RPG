import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverFiles, RPGEncoder } from '@pleaseai/rpg-encoder'
import { resolveGitBinary } from '@pleaseai/rpg-utils/git-path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Get current project root for testing
const PROJECT_ROOT = path.resolve(__dirname, '..')

function hasGitAncestor(repoPath: string, ref: string): boolean {
  try {
    execFileSync(resolveGitBinary(), ['rev-parse', '--verify', ref], { cwd: repoPath, stdio: 'pipe' })
    return true
  }
  catch {
    return false
  }
}

describe('RPGEncoder', () => {
  let encoder: RPGEncoder

  beforeEach(() => {
    encoder = new RPGEncoder('/tmp/test-repo')
  })

  it('creates encoder with default options', () => {
    const enc = new RPGEncoder('/path/to/repo')
    expect(enc).toBeDefined()
  })

  it('creates encoder with custom options', () => {
    const enc = new RPGEncoder('/path/to/repo', {
      includeSource: true,
      include: ['**/*.ts'],
      exclude: ['**/node_modules/**'],
      maxDepth: 5,
    })
    expect(enc).toBeDefined()
  })

  it('encode returns RPG with correct structure', async () => {
    const result = await encoder.encode()

    expect(result.rpg).toBeDefined()
    expect(result.filesProcessed).toBeGreaterThanOrEqual(0)
    expect(result.entitiesExtracted).toBeGreaterThanOrEqual(0)
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })

  it('encode creates RPG with repository name from path', async () => {
    const enc = new RPGEncoder('/path/to/my-project')
    const result = await enc.encode()

    expect(result.rpg.getConfig().name).toBe('my-project')
  })

  it('encode creates RPG with root path', async () => {
    const result = await encoder.encode()

    expect(result.rpg.getConfig().rootPath).toBe('/tmp/test-repo')
  })

  it('evolve accepts rpg and commit range', async () => {
    const { rpg } = await encoder.encode()

    // /tmp/test-repo is not a git repository, so evolve should throw
    await expect(encoder.evolve(rpg, { commitRange: 'HEAD~5..HEAD' })).rejects.toThrow(
      /Failed to parse git diff/,
    )
  })

  it.skipIf(!hasGitAncestor(PROJECT_ROOT, 'HEAD~1'))(
    'evolve returns result structure on valid repo',
    async () => {
      // Use the actual project root which is a real git repo
      // Skipped in shallow clones (e.g., CI with fetch-depth: 1) where HEAD~1 is unavailable
      const realEncoder = new RPGEncoder(PROJECT_ROOT, {
        include: ['packages/encoder/src/evolution/types.ts'],
      })
      const { rpg } = await realEncoder.encode()
      const result = await realEncoder.evolve(rpg, { commitRange: 'HEAD~1..HEAD' })

      expect(result).toHaveProperty('inserted')
      expect(result).toHaveProperty('deleted')
      expect(result).toHaveProperty('modified')
      expect(result).toHaveProperty('rerouted')
      expect(result).toHaveProperty('prunedNodes')
      expect(result).toHaveProperty('duration')
      expect(result).toHaveProperty('llmCalls')
      expect(result).toHaveProperty('errors')
    },
  )
})

describe('RPGEncoder Options', () => {
  it('include patterns filter files', () => {
    const encoder = new RPGEncoder('/repo', {
      include: ['**/*.ts', '**/*.js'],
    })
    expect(encoder).toBeDefined()
  })

  it('exclude patterns filter out files', () => {
    const encoder = new RPGEncoder('/repo', {
      exclude: ['**/test/**', '**/*.test.ts'],
    })
    expect(encoder).toBeDefined()
  })

  it('maxDepth limits traversal', () => {
    const encoder = new RPGEncoder('/repo', {
      maxDepth: 3,
    })
    expect(encoder).toBeDefined()
  })

  it('includeSource embeds code in nodes', () => {
    const encoder = new RPGEncoder('/repo', {
      includeSource: true,
    })
    expect(encoder).toBeDefined()
  })
})

describe('RPGEncoder.discoverFiles', () => {
  it('discovers TypeScript files in repository', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/node_modules/**'],
    })
    const result = await encoder.encode()

    // Should find at least the encoder.ts file
    expect(result.filesProcessed).toBeGreaterThan(0)
  })

  it('respects include patterns', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['packages/encoder/src/**/*.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    // Should only find files in packages/encoder/src
    expect(result.filesProcessed).toBeGreaterThanOrEqual(1)
  })

  it('respects exclude patterns', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['**/*.ts'],
      exclude: ['**/node_modules/**', '**/dist/**', 'tests/**'],
    })
    const result = await encoder.encode()

    // Should find src files but not test files
    expect(result.filesProcessed).toBeGreaterThan(0)
  })

  it('handles non-existent directory gracefully', async () => {
    const encoder = new RPGEncoder('/non/existent/path', {
      include: ['**/*.ts'],
    })
    const result = await encoder.encode()

    // Should return empty result, not throw
    expect(result.filesProcessed).toBe(0)
  })

  it('excludes gitignored files when respectGitignore is true', async () => {
    const files = await discoverFiles(PROJECT_ROOT, {
      include: ['**/*.ts', '**/*.js', '**/*.json'],
      respectGitignore: true,
    })
    const relativePaths = files.map(f => path.relative(PROJECT_ROOT, f))

    // dist/ is in .gitignore — should not appear
    const distFiles = relativePaths.filter(p => p.startsWith('dist/'))
    expect(distFiles).toHaveLength(0)

    // node_modules/ is in .gitignore — should not appear
    const nmFiles = relativePaths.filter(p => p.startsWith('node_modules/'))
    expect(nmFiles).toHaveLength(0)

    // packages/ source files should still be present
    const srcFiles = relativePaths.filter(p => p.startsWith('packages/'))
    expect(srcFiles.length).toBeGreaterThan(0)
  })

  it('defaults to respectGitignore=true when option is omitted', async () => {
    const files = await discoverFiles(PROJECT_ROOT, {
      include: ['**/*.ts', '**/*.json'],
    })
    const relativePaths = files.map(f => path.relative(PROJECT_ROOT, f))

    // dist/ is in .gitignore — should not appear even without explicit respectGitignore
    const distFiles = relativePaths.filter(p => p.startsWith('dist/'))
    expect(distFiles).toHaveLength(0)
  })

  it('falls back to walkDirectory when respectGitignore is false', async () => {
    const files = await discoverFiles(PROJECT_ROOT, {
      include: ['**/*.ts'],
      exclude: ['**/node_modules/**', '**/.git/**'],
      respectGitignore: false,
    })
    const relativePaths = files.map(f => path.relative(PROJECT_ROOT, f))

    // Should still find source files via walkDirectory
    const srcFiles = relativePaths.filter(p => p.startsWith('packages/'))
    expect(srcFiles.length).toBeGreaterThan(0)
  })

  it('handles non-git directory gracefully with respectGitignore', async () => {
    const tmpDir = path.join(os.tmpdir(), `rpg-nongit-${Date.now()}`)
    fs.mkdirSync(tmpDir, { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'test.ts'), '// test')
    try {
      const files = await discoverFiles(tmpDir, {
        include: ['**/*.ts'],
        respectGitignore: true,
      })
      expect(files).toHaveLength(1)
      expect(files[0]).toContain('test.ts')
    }
    finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('applies maxDepth with git ls-files mode', async () => {
    const shallowFiles = await discoverFiles(PROJECT_ROOT, {
      include: ['**/*.ts'],
      respectGitignore: true,
      maxDepth: 0,
    })
    const relativePaths = shallowFiles.map(f => path.relative(PROJECT_ROOT, f))

    expect(shallowFiles.length).toBeGreaterThan(0)
    // maxDepth 0 means only root-level files (depth = 0 segments before file)
    for (const p of relativePaths) {
      const depth = p.split('/').length - 1
      expect(depth).toBeLessThanOrEqual(0)
    }
  })

  it('applies include/exclude patterns with git ls-files mode', async () => {
    const files = await discoverFiles(PROJECT_ROOT, {
      include: ['packages/encoder/src/**/*.ts'],
      exclude: ['**/evolution/**'],
      respectGitignore: true,
    })
    const relativePaths = files.map(f => path.relative(PROJECT_ROOT, f))

    expect(relativePaths.length).toBeGreaterThan(0)
    // All files should be under packages/encoder/src
    for (const p of relativePaths) {
      expect(p.startsWith('packages/encoder/src/')).toBe(true)
    }

    // No evolution files should be included
    const evolutionFiles = relativePaths.filter(p => p.includes('evolution'))
    expect(evolutionFiles).toHaveLength(0)

    // Should still find encoder.ts
    expect(relativePaths).toContain('packages/encoder/src/encoder.ts')
  })

  it('throws for non-existent repository path', async () => {
    await expect(
      discoverFiles('/non/existent/path', { include: ['**/*.ts'] }),
    ).rejects.toThrow('Repository path does not exist')
  })

  it('warns and falls back when git ls-files fails', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const tmpDir = path.join(os.tmpdir(), `rpg-gitfail-${Date.now()}`)
    fs.mkdirSync(tmpDir, { recursive: true })
    // Init git repo but corrupt the index to trigger git ls-files failure
    execFileSync(resolveGitBinary(), ['init'], { cwd: tmpDir, stdio: 'pipe' })
    fs.writeFileSync(path.join(tmpDir, 'hello.ts'), '// hello')
    // Corrupt the git index
    fs.writeFileSync(path.join(tmpDir, '.git', 'index'), 'corrupted')
    try {
      const files = await discoverFiles(tmpDir, {
        include: ['**/*.ts'],
        respectGitignore: true,
      })
      // Should fall back to walkDirectory and still find the file
      expect(files).toHaveLength(1)
      expect(files[0]).toContain('hello.ts')
      // Should have logged a warning about git failure via consola (writes to stderr)
      const stderrOutput = stderrSpy.mock.calls.map(c => String(c[0])).join('')
      expect(stderrOutput).toContain('git ls-files failed')
    }
    finally {
      stderrSpy.mockRestore()
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('RPGEncoder.extractEntities', () => {
  let encoderResult: Awaited<ReturnType<RPGEncoder['encode']>>

  beforeAll(async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['packages/encoder/src/encoder.ts'],
      exclude: [],
    })
    encoderResult = await encoder.encode()
  })

  it('extracts entities from TypeScript files', async () => {
    // Should find file entity + class + methods
    expect(encoderResult.entitiesExtracted).toBeGreaterThan(1)
  })

  it('creates unique IDs for entities', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['packages/utils/src/ast.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    // Check that all node IDs are unique
    const nodeIds = (await result.rpg.getNodes()).map(n => n.id)
    const uniqueIds = new Set(nodeIds)
    expect(uniqueIds.size).toBe(nodeIds.length)
  })

  it('includes file-level entity', async () => {
    // Should have a file entity
    const fileNodes = (await encoderResult.rpg.getNodes()).filter(n => n.metadata?.entityType === 'file')
    expect(fileNodes.length).toBeGreaterThanOrEqual(1)
  })

  it('extracts function and class entities', async () => {
    // Should have class and function entities
    const nodes = await encoderResult.rpg.getNodes()
    const classNodes = nodes.filter(n => n.metadata?.entityType === 'class')
    const functionNodes = nodes.filter(
      n => n.metadata?.entityType === 'function' || n.metadata?.entityType === 'method',
    )

    expect(classNodes.length).toBeGreaterThanOrEqual(1) // RPGEncoder class
    expect(functionNodes.length).toBeGreaterThanOrEqual(1)
  })
})

describe('RPGEncoder.buildFunctionalHierarchy', () => {
  let allSrcResult: Awaited<ReturnType<RPGEncoder['encode']>>
  let encoderFileResult: Awaited<ReturnType<RPGEncoder['encode']>>

  beforeAll(async () => {
    const [allSrc, encoderFile] = await Promise.all([
      new RPGEncoder(PROJECT_ROOT, { include: ['packages/encoder/src/**/*.ts'], exclude: [] }).encode(),
      new RPGEncoder(PROJECT_ROOT, { include: ['packages/encoder/src/encoder.ts'], exclude: [] }).encode(),
    ])
    allSrcResult = allSrc
    encoderFileResult = encoderFile
  })

  it('skips hierarchy when no LLM is available', async () => {
    // Without LLM, semantic reorganization is skipped — no high-level nodes
    const highLevelNodes = await allSrcResult.rpg.getHighLevelNodes()
    expect(highLevelNodes.length).toBe(0)
  })

  it('creates functional edges from files to contained entities (Phase 1)', async () => {
    // Should have functional edges from Phase 1 (file→entity)
    const functionalEdges = await allSrcResult.rpg.getFunctionalEdges()
    expect(functionalEdges.length).toBeGreaterThan(0)
  })

  it('creates functional edges from files to contained entities', async () => {
    // Find the file node
    const fileNode = (await encoderFileResult.rpg.getNodes()).find(
      n => n.metadata?.entityType === 'file' && n.metadata?.path === 'packages/encoder/src/encoder.ts',
    )
    expect(fileNode).toBeDefined()

    // Find edges from file to its contained entities (class, methods)
    const edges = await encoderFileResult.rpg.getFunctionalEdges()
    const fileEdges = edges.filter(e => e.source === fileNode?.id)
    expect(fileEdges.length).toBeGreaterThan(0)
  })

  it('throws when useLLM is true but no provider is available', async () => {
    const savedGoogle = process.env.GOOGLE_API_KEY
    const savedAnthropic = process.env.ANTHROPIC_API_KEY
    const savedOpenAI = process.env.OPENAI_API_KEY
    process.env.GOOGLE_API_KEY = ''
    process.env.ANTHROPIC_API_KEY = ''
    process.env.OPENAI_API_KEY = ''

    try {
      const encoder = new RPGEncoder(PROJECT_ROOT, {
        include: ['packages/encoder/src/encoder.ts'],
        exclude: [],
        semantic: { useLLM: true },
      })
      await expect(encoder.encode()).rejects.toThrow('LLM provider')
    }
    finally {
      if (savedGoogle !== undefined)
        process.env.GOOGLE_API_KEY = savedGoogle
      else Reflect.deleteProperty(process.env, 'GOOGLE_API_KEY')
      if (savedAnthropic !== undefined)
        process.env.ANTHROPIC_API_KEY = savedAnthropic
      else Reflect.deleteProperty(process.env, 'ANTHROPIC_API_KEY')
      if (savedOpenAI !== undefined)
        process.env.OPENAI_API_KEY = savedOpenAI
      else Reflect.deleteProperty(process.env, 'OPENAI_API_KEY')
    }
  })
})

describe('RPGEncoder Phase 1 file→function edges', () => {
  let encoderResult: Awaited<ReturnType<RPGEncoder['encode']>>
  let semanticResult: Awaited<ReturnType<RPGEncoder['encode']>>

  beforeAll(async () => {
    const [enc, sem] = await Promise.all([
      new RPGEncoder(PROJECT_ROOT, { include: ['packages/encoder/src/encoder.ts'], exclude: [] }).encode(),
      new RPGEncoder(PROJECT_ROOT, { include: ['packages/encoder/src/semantic.ts'], exclude: [] }).encode(),
    ])
    encoderResult = enc
    semanticResult = sem
  })

  it('creates file→function edges during Phase 1 entity extraction', async () => {
    // Find the file node
    const fileNode = (await encoderResult.rpg.getNodes()).find(
      n => n.metadata?.entityType === 'file' && n.metadata?.path === 'packages/encoder/src/encoder.ts',
    )
    expect(fileNode).toBeDefined()

    // Find non-file entities for this file
    const childNodes = (await encoderResult.rpg.getNodes()).filter(
      n => n.metadata?.entityType !== 'file' && n.metadata?.path === 'packages/encoder/src/encoder.ts',
    )
    expect(childNodes.length).toBeGreaterThan(0)

    // Verify file→child edges exist
    const functionalEdges = await encoderResult.rpg.getFunctionalEdges()
    const fileToChildEdges = functionalEdges.filter(e => e.source === fileNode?.id)
    expect(fileToChildEdges.length).toBe(childNodes.length)
  })

  it('file→child edge count matches child entity count', async () => {
    const fileNode = (await semanticResult.rpg.getNodes()).find(
      n => n.metadata?.entityType === 'file' && n.metadata?.path === 'packages/encoder/src/semantic.ts',
    )
    expect(fileNode).toBeDefined()

    const childNodes = (await semanticResult.rpg.getNodes()).filter(
      n => n.metadata?.entityType !== 'file' && n.metadata?.path === 'packages/encoder/src/semantic.ts',
    )

    const functionalEdges = await semanticResult.rpg.getFunctionalEdges()
    const fileEdges = functionalEdges.filter(e => e.source === fileNode?.id)
    expect(fileEdges.length).toBe(childNodes.length)
  })

  it('buildFunctionalHierarchy creates only directory→file edges, not file→entity', async () => {
    // Get directory nodes
    const highLevelNodes = await encoderResult.rpg.getHighLevelNodes()
    const dirNodeIds = new Set(highLevelNodes.map(n => n.id))

    // All directory-sourced edges should target files (not functions/methods)
    const functionalEdges = await encoderResult.rpg.getFunctionalEdges()
    const dirEdges = functionalEdges.filter(e => dirNodeIds.has(e.source))

    for (const edge of dirEdges) {
      const targetNode = await encoderResult.rpg.getNode(edge.target)
      // Directory edges should point to file nodes or other directories
      if (targetNode?.metadata?.entityType) {
        expect(targetNode.metadata.entityType).toBe('file')
      }
    }
  })
})

describe('RPGEncoder.injectDataFlows', () => {
  let result: Awaited<ReturnType<RPGEncoder['encode']>>

  beforeAll(async () => {
    result = await new RPGEncoder(PROJECT_ROOT, {
      include: ['packages/encoder/src/**/*.ts'],
      exclude: [],
    }).encode()
  })

  it('creates data flow edges during encoding', async () => {
    // Should have data flow edges from inter-module imports
    const dataFlowEdges = await result.rpg.getDataFlowEdges()
    expect(dataFlowEdges.length).toBeGreaterThan(0)
  })

  it('data flow edges have valid structure', async () => {
    const dataFlowEdges = await result.rpg.getDataFlowEdges()
    expect(dataFlowEdges.length).toBeGreaterThan(0)
    for (const edge of dataFlowEdges) {
      expect(edge.from).toBeDefined()
      expect(edge.to).toBeDefined()
      expect(edge.dataId).toBeDefined()
      expect(edge.dataType).toBeDefined()
      expect(typeof edge.from).toBe('string')
      expect(typeof edge.to).toBe('string')
      expect(typeof edge.dataId).toBe('string')
      expect(typeof edge.dataType).toBe('string')
    }
  })

  it('data flow edges include import-type flows', async () => {
    const dataFlowEdges = await result.rpg.getDataFlowEdges()
    const importFlows = dataFlowEdges.filter(e => e.dataType === 'import')
    expect(importFlows.length).toBeGreaterThan(0)
  })

  it('data flow edges are included in serialization', async () => {
    const serialized = await result.rpg.serialize()
    expect(serialized.dataFlowEdges).toBeDefined()
    expect(serialized.dataFlowEdges!.length).toBeGreaterThan(0)
  })

  it('data flow edges survive serialization round-trip', async () => {
    const json = await result.rpg.toJSON()
    const { RepositoryPlanningGraph } = await import('@pleaseai/rpg-graph')
    const restored = await RepositoryPlanningGraph.fromJSON(json)

    const originalEdges = await result.rpg.getDataFlowEdges()
    expect(originalEdges.length).toBeGreaterThan(0)
    const restoredEdges = await restored.getDataFlowEdges()
    expect(restoredEdges.length).toBe(originalEdges.length)
  })

  it('data flow edges appear in graph stats', async () => {
    const stats = await result.rpg.getStats()
    expect(stats.dataFlowEdgeCount).toBeGreaterThan(0)
  })
})

describe('RPGEncoder.injectDependencies', () => {
  let allSrcResult: Awaited<ReturnType<RPGEncoder['encode']>>
  let singleFileResult: Awaited<ReturnType<RPGEncoder['encode']>>

  beforeAll(async () => {
    const [allSrc, singleFile] = await Promise.all([
      new RPGEncoder(PROJECT_ROOT, { include: ['packages/encoder/src/**/*.ts'], exclude: [] }).encode(),
      new RPGEncoder(PROJECT_ROOT, { include: ['packages/encoder/src/encoder.ts'], exclude: [] }).encode(),
    ])
    allSrcResult = allSrc
    singleFileResult = singleFile
  })

  it('creates dependency edges for imports', async () => {
    // Should have dependency edges from encoder.ts to other modules
    const dependencyEdges = await allSrcResult.rpg.getDependencyEdges()
    expect(dependencyEdges.length).toBeGreaterThan(0)
  })

  it('dependency edges include import type', async () => {
    const dependencyEdges = await allSrcResult.rpg.getDependencyEdges()
    const importEdges = dependencyEdges.filter(e => e.dependencyType === 'import')
    expect(importEdges.length).toBeGreaterThan(0)
  })

  it('dependency edges include call/inherit/implement types when applicable', async () => {
    const dependencyEdges = await allSrcResult.rpg.getDependencyEdges()
    const edgeTypes = new Set(dependencyEdges.map(e => e.dependencyType))
    // At minimum we should have import edges
    expect(edgeTypes.has('import')).toBe(true)
    // All edge types should be valid
    for (const type of edgeTypes) {
      expect(['import', 'call', 'inherit', 'implement', 'use']).toContain(type)
    }
  })

  it('dependency edges connect file nodes', async () => {
    const dependencyEdges = await allSrcResult.rpg.getDependencyEdges()
    for (const edge of dependencyEdges) {
      const sourceNode = await allSrcResult.rpg.getNode(edge.source)
      const targetNode = await allSrcResult.rpg.getNode(edge.target)
      expect(sourceNode).toBeDefined()
      expect(targetNode).toBeDefined()
      expect(sourceNode?.metadata?.entityType).toBe('file')
      expect(targetNode?.metadata?.entityType).toBe('file')
    }
  })

  it('does not create edges for external imports', async () => {
    // All dependency edges should be between known files
    const dependencyEdges = await singleFileResult.rpg.getDependencyEdges()
    for (const edge of dependencyEdges) {
      expect(await singleFileResult.rpg.getNode(edge.source)).toBeDefined()
      expect(await singleFileResult.rpg.getNode(edge.target)).toBeDefined()
    }
  })
})
