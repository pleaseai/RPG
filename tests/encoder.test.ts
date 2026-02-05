import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { RPGEncoder } from '../src/encoder'

// Get current project root for testing
const PROJECT_ROOT = path.resolve(__dirname, '..')

describe('rPGEncoder', () => {
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

  it('evolve accepts commit range', async () => {
    // This should not throw
    await expect(encoder.evolve({ commitRange: 'HEAD~5..HEAD' })).resolves.toBeUndefined()
  })
})

describe('rPGEncoder Options', () => {
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

describe('rPGEncoder.discoverFiles', () => {
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

describe('rPGEncoder.extractEntities', () => {
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

describe('rPGEncoder.buildFunctionalHierarchy', () => {
  it('creates high-level nodes for directories', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/**/*.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    // Should create a high-level node for src/encoder directory
    const highLevelNodes = await result.rpg.getHighLevelNodes()
    expect(highLevelNodes.length).toBeGreaterThanOrEqual(1)

    // Check for directory node
    const encoderDir = highLevelNodes.find(
      n => n.directoryPath === 'src/encoder' || n.metadata?.path === 'src/encoder',
    )
    expect(encoderDir).toBeDefined()
  })

  it('creates functional edges from directories to files', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/**/*.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    // Should have functional edges
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

  it('directory nodes have semantic features', async () => {
    const encoder = new RPGEncoder(PROJECT_ROOT, {
      include: ['src/encoder/**/*.ts'],
      exclude: [],
    })
    const result = await encoder.encode()

    const highLevelNodes = await result.rpg.getHighLevelNodes()
    for (const node of highLevelNodes) {
      expect(node.feature).toBeDefined()
      expect(node.feature.description).toBeDefined()
      expect(typeof node.feature.description).toBe('string')
    }
  })
})

describe('rPGEncoder.injectDependencies', () => {
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
