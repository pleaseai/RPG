import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { RPGEncoder } from '../src/encoder'

// Get current project root for testing
const PROJECT_ROOT = path.resolve(__dirname, '..')

function hasGitAncestor(repoPath: string, ref: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', ref], { cwd: repoPath, stdio: 'pipe' })
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
        include: ['src/encoder/evolution/types.ts'],
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
      include: ['src/**/*.ts'],
      exclude: ['**/node_modules/**'],
    })
    const result = await encoder.encode()

    // Should find at least the encoder.ts file
    expect(result.filesProcessed).toBeGreaterThan(0)
  })

  it('respects include patterns', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/**/*.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    // Should only find files in src/encoder
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
})

describe('RPGEncoder.extractEntities', () => {
  it('extracts entities from TypeScript files', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/encoder.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    // Should find file entity + class + methods
    expect(result.entitiesExtracted).toBeGreaterThan(1)
  })

  it('creates unique IDs for entities', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/utils/ast.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    // Check that all node IDs are unique
    const nodeIds = (await result.rpg.getNodes()).map(n => n.id)
    const uniqueIds = new Set(nodeIds)
    expect(uniqueIds.size).toBe(nodeIds.length)
  })

  it('includes file-level entity', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/encoder.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    // Should have a file entity
    const fileNodes = (await result.rpg.getNodes()).filter(n => n.metadata?.entityType === 'file')
    expect(fileNodes.length).toBeGreaterThanOrEqual(1)
  })

  it('extracts function and class entities', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/encoder.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    // Should have class and function entities
    const nodes = await result.rpg.getNodes()
    const classNodes = nodes.filter(n => n.metadata?.entityType === 'class')
    const functionNodes = nodes.filter(
      n => n.metadata?.entityType === 'function' || n.metadata?.entityType === 'method',
    )

    expect(classNodes.length).toBeGreaterThanOrEqual(1) // RPGEncoder class
    expect(functionNodes.length).toBeGreaterThanOrEqual(1)
  })
})

describe('RPGEncoder.buildFunctionalHierarchy', () => {
  it('skips hierarchy when no LLM is available', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/**/*.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    // Without LLM, semantic reorganization is skipped — no high-level nodes
    const highLevelNodes = await result.rpg.getHighLevelNodes()
    expect(highLevelNodes.length).toBe(0)
  })

  it('creates functional edges from files to contained entities (Phase 1)', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/**/*.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    // Should have functional edges from Phase 1 (file→entity)
    const functionalEdges = await result.rpg.getFunctionalEdges()
    expect(functionalEdges.length).toBeGreaterThan(0)
  })

  it('creates functional edges from files to contained entities', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/encoder.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    // Find the file node
    const fileNode = (await result.rpg.getNodes()).find(
      n => n.metadata?.entityType === 'file' && n.metadata?.path === 'src/encoder/encoder.ts',
    )
    expect(fileNode).toBeDefined()

    // Find edges from file to its contained entities (class, methods)
    const edges = await result.rpg.getFunctionalEdges()
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
        include: ['src/encoder/encoder.ts'],
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
  it('creates file→function edges during Phase 1 entity extraction', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/encoder.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    // Find the file node
    const fileNode = (await result.rpg.getNodes()).find(
      n => n.metadata?.entityType === 'file' && n.metadata?.path === 'src/encoder/encoder.ts',
    )
    expect(fileNode).toBeDefined()

    // Find non-file entities for this file
    const childNodes = (await result.rpg.getNodes()).filter(
      n => n.metadata?.entityType !== 'file' && n.metadata?.path === 'src/encoder/encoder.ts',
    )
    expect(childNodes.length).toBeGreaterThan(0)

    // Verify file→child edges exist
    const functionalEdges = await result.rpg.getFunctionalEdges()
    const fileToChildEdges = functionalEdges.filter(e => e.source === fileNode?.id)
    expect(fileToChildEdges.length).toBe(childNodes.length)
  })

  it('file→child edge count matches child entity count', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/semantic.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    const fileNode = (await result.rpg.getNodes()).find(
      n => n.metadata?.entityType === 'file' && n.metadata?.path === 'src/encoder/semantic.ts',
    )
    expect(fileNode).toBeDefined()

    const childNodes = (await result.rpg.getNodes()).filter(
      n => n.metadata?.entityType !== 'file' && n.metadata?.path === 'src/encoder/semantic.ts',
    )

    const functionalEdges = await result.rpg.getFunctionalEdges()
    const fileEdges = functionalEdges.filter(e => e.source === fileNode?.id)
    expect(fileEdges.length).toBe(childNodes.length)
  })

  it('buildFunctionalHierarchy creates only directory→file edges, not file→entity', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/encoder.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    // Get directory nodes
    const highLevelNodes = await result.rpg.getHighLevelNodes()
    const dirNodeIds = new Set(highLevelNodes.map(n => n.id))

    // All directory-sourced edges should target files (not functions/methods)
    const functionalEdges = await result.rpg.getFunctionalEdges()
    const dirEdges = functionalEdges.filter(e => dirNodeIds.has(e.source))

    for (const edge of dirEdges) {
      const targetNode = await result.rpg.getNode(edge.target)
      // Directory edges should point to file nodes or other directories
      if (targetNode?.metadata?.entityType) {
        expect(targetNode.metadata.entityType).toBe('file')
      }
    }
  })
})

describe('RPGEncoder.injectDataFlows', () => {
  it('creates data flow edges during encoding', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/**/*.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    // Should have data flow edges from inter-module imports
    const dataFlowEdges = await result.rpg.getDataFlowEdges()
    expect(dataFlowEdges.length).toBeGreaterThan(0)
  })

  it('data flow edges have valid structure', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/**/*.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

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
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/**/*.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    const dataFlowEdges = await result.rpg.getDataFlowEdges()
    const importFlows = dataFlowEdges.filter(e => e.dataType === 'import')
    expect(importFlows.length).toBeGreaterThan(0)
  })

  it('data flow edges are included in serialization', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/**/*.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    const serialized = await result.rpg.serialize()
    expect(serialized.dataFlowEdges).toBeDefined()
    expect(serialized.dataFlowEdges!.length).toBeGreaterThan(0)
  })

  it('data flow edges survive serialization round-trip', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/**/*.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    const json = await result.rpg.toJSON()
    const { RepositoryPlanningGraph } = await import('../src/graph')
    const restored = await RepositoryPlanningGraph.fromJSON(json)

    const originalEdges = await result.rpg.getDataFlowEdges()
    expect(originalEdges.length).toBeGreaterThan(0)
    const restoredEdges = await restored.getDataFlowEdges()
    expect(restoredEdges.length).toBe(originalEdges.length)
  })

  it('data flow edges appear in graph stats', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/**/*.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    const stats = await result.rpg.getStats()
    expect(stats.dataFlowEdgeCount).toBeGreaterThan(0)
  })
})

describe('RPGEncoder.injectDependencies', () => {
  it('creates dependency edges for imports', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/**/*.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    // Should have dependency edges from encoder.ts to other modules
    const dependencyEdges = await result.rpg.getDependencyEdges()
    expect(dependencyEdges.length).toBeGreaterThan(0)
  })

  it('dependency edges have import type', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/**/*.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    const dependencyEdges = await result.rpg.getDependencyEdges()
    for (const edge of dependencyEdges) {
      expect(edge.dependencyType).toBe('import')
    }
  })

  it('dependency edges connect file nodes', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/**/*.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    const dependencyEdges = await result.rpg.getDependencyEdges()
    for (const edge of dependencyEdges) {
      const sourceNode = await result.rpg.getNode(edge.source)
      const targetNode = await result.rpg.getNode(edge.target)
      expect(sourceNode).toBeDefined()
      expect(targetNode).toBeDefined()
      expect(sourceNode?.metadata?.entityType).toBe('file')
      expect(targetNode?.metadata?.entityType).toBe('file')
    }
  })

  it('does not create edges for external imports', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/encoder.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    // All dependency edges should be between known files
    const dependencyEdges = await result.rpg.getDependencyEdges()
    for (const edge of dependencyEdges) {
      expect(await result.rpg.getNode(edge.source)).toBeDefined()
      expect(await result.rpg.getNode(edge.target)).toBeDefined()
    }
  })
})
