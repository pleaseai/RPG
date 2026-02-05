import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RPGEncoder } from '../../src/encoder'
import { MockEmbedding } from '../../src/encoder/embedding'
import { SemanticSearch } from '../../src/encoder/semantic-search'
import { RepositoryPlanningGraph } from '../../src/graph'

// This test suite encodes the actual rpg repository
const PROJECT_ROOT = resolve(__dirname, '../..')

describe('e2E: Encode Real Repository', () => {
  describe('encode rpg Project', () => {
    it('should encode the entire src directory', async () => {
      const encoder = new RPGEncoder(PROJECT_ROOT, {
        include: ['src/**/*.ts'],
        exclude: ['**/node_modules/**', '**/dist/**'],
      })

      const result = await encoder.encode()

      // Should process multiple files
      expect(result.filesProcessed).toBeGreaterThan(10)

      // Should extract many entities
      expect(result.entitiesExtracted).toBeGreaterThan(50)

      // RPG should be named after the project
      expect(result.rpg.getConfig().name).toBe('rpg')

      // Should have both high-level and low-level nodes
      expect((await result.rpg.getHighLevelNodes()).length).toBeGreaterThan(0)
      expect((await result.rpg.getLowLevelNodes()).length).toBeGreaterThan(0)

      // Should have both functional and dependency edges
      expect((await result.rpg.getFunctionalEdges()).length).toBeGreaterThan(0)
      expect((await result.rpg.getDependencyEdges()).length).toBeGreaterThan(0)

      // Duration should be reasonable (under 30 seconds)
      expect(result.duration).toBeLessThan(30000)
    })

    it('should produce consistent results across multiple runs', async () => {
      const encoder1 = new RPGEncoder(PROJECT_ROOT, {
        include: ['src/graph/**/*.ts'],
        exclude: [],
      })

      const encoder2 = new RPGEncoder(PROJECT_ROOT, {
        include: ['src/graph/**/*.ts'],
        exclude: [],
      })

      const result1 = await encoder1.encode()
      const result2 = await encoder2.encode()

      // Same number of files and entities
      expect(result1.filesProcessed).toBe(result2.filesProcessed)
      expect(result1.entitiesExtracted).toBe(result2.entitiesExtracted)

      // Same node IDs
      const ids1 = new Set((await result1.rpg.getNodes()).map(n => n.id))
      const ids2 = new Set((await result2.rpg.getNodes()).map(n => n.id))
      expect(ids1).toEqual(ids2)
    })

    it('should correctly identify module dependencies', async () => {
      const encoder = new RPGEncoder(PROJECT_ROOT, {
        include: ['src/encoder/**/*.ts'],
        exclude: [],
      })

      const result = await encoder.encode()

      // encoder.ts should import from semantic.ts, cache.ts
      const edges = await result.rpg.getDependencyEdges()
      const encoderFile = (await result.rpg.getNodes()).find(
        n => n.metadata?.path === 'src/encoder/encoder.ts',
      )

      expect(encoderFile).toBeDefined()

      // Find imports from encoder.ts
      const encoderImports = edges.filter(e => e.source === encoderFile?.id)
      expect(encoderImports.length).toBeGreaterThan(0)

      // Should import from semantic.ts or cache.ts
      const importedPaths = await Promise.all(
        encoderImports.map(async (e) => {
          const targetNode = await result.rpg.getNode(e.target)
          return targetNode?.metadata?.path
        }),
      )

      const hasInternalImports = importedPaths.some(
        p => p?.includes('semantic.ts') || p?.includes('cache.ts'),
      )
      expect(hasInternalImports).toBe(true)
    })

    it('should build correct functional hierarchy', async () => {
      const encoder = new RPGEncoder(PROJECT_ROOT, {
        include: ['src/**/*.ts'],
        exclude: ['**/node_modules/**'],
      })

      const result = await encoder.encode()

      const highLevelNodes = await result.rpg.getHighLevelNodes()
      const functionalEdges = await result.rpg.getFunctionalEdges()

      // Should have directory nodes for src subdirectories
      const dirPaths = highLevelNodes.map(n => n.directoryPath || n.metadata?.path)
      expect(dirPaths.some(p => p?.includes('encoder'))).toBe(true)
      expect(dirPaths.some(p => p?.includes('graph'))).toBe(true)
      expect(dirPaths.some(p => p?.includes('utils'))).toBe(true)

      // Functional edges should connect directories to files
      const dirToFileEdgesChecks = await Promise.all(
        functionalEdges.map(async (e) => {
          const sourceNode = await result.rpg.getNode(e.source)
          const targetNode = await result.rpg.getNode(e.target)
          return (
            sourceNode?.metadata?.entityType === 'module'
            && targetNode?.metadata?.entityType === 'file'
          )
        }),
      )
      const dirToFileEdges = functionalEdges.filter((_, i) => dirToFileEdgesChecks[i])
      expect(dirToFileEdges.length).toBeGreaterThan(0)
    })
  })

  describe('serialization Roundtrip', () => {
    it('should serialize and restore full RPG without data loss', async () => {
      const encoder = new RPGEncoder(PROJECT_ROOT, {
        include: ['src/graph/**/*.ts'],
        exclude: [],
      })

      const result = await encoder.encode()

      // Serialize
      const json = await result.rpg.toJSON()

      // Verify JSON is valid
      expect(() => JSON.parse(json)).not.toThrow()

      // Deserialize
      const restored = await RepositoryPlanningGraph.fromJSON(json)

      // Compare structure
      expect((await restored.getNodes()).length).toBe((await result.rpg.getNodes()).length)
      expect((await restored.getFunctionalEdges()).length).toBe(
        (await result.rpg.getFunctionalEdges()).length,
      )
      expect((await restored.getDependencyEdges()).length).toBe(
        (await result.rpg.getDependencyEdges()).length,
      )

      // Compare individual nodes
      for (const originalNode of await result.rpg.getNodes()) {
        const restoredNode = await restored.getNode(originalNode.id)
        expect(restoredNode).toBeDefined()
        expect(restoredNode?.feature).toEqual(originalNode.feature)
        expect(restoredNode?.metadata).toEqual(originalNode.metadata)
      }
    })
  })

  describe('semantic Search E2E', () => {
    let search: SemanticSearch
    let searchDbPath: string

    beforeEach(async () => {
      searchDbPath = join(tmpdir(), `rpg-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      const embedding = new MockEmbedding(128)
      search = new SemanticSearch({
        dbPath: searchDbPath,
        embedding,
      })
    })

    afterEach(async () => {
      await search.close()
      try {
        await rm(searchDbPath, { recursive: true, force: true })
      }
      catch {
        // Ignore cleanup errors
      }
    })

    it('should enable semantic search over encoded repository', async () => {
      // Encode a subset of the repository
      const encoder = new RPGEncoder(PROJECT_ROOT, {
        include: ['src/encoder/**/*.ts'],
        exclude: [],
      })

      const result = await encoder.encode()

      // Index all nodes
      const documents = (await result.rpg.getNodes()).map(node => ({
        id: node.id,
        content: node.feature.description,
        metadata: {
          entityType: node.metadata?.entityType,
          path: node.metadata?.path,
        },
      }))

      await search.indexBatch(documents)

      // Search for encoding-related entities
      const encodingResults = await search.search('encode repository semantic', 5)
      expect(encodingResults.length).toBeGreaterThan(0)

      // Search for AST/parsing related entities
      const astResults = await search.search('parse syntax tree', 5)
      expect(astResults.length).toBeGreaterThan(0)

      // Search for caching related entities
      const cacheResults = await search.search('cache storage', 5)
      expect(cacheResults.length).toBeGreaterThan(0)
    })

    it('should find specific classes and functions by description', async () => {
      const encoder = new RPGEncoder(PROJECT_ROOT, {
        include: ['src/encoder/encoder.ts'],
        exclude: [],
      })

      const result = await encoder.encode()

      // Index nodes
      const allNodes = await result.rpg.getNodes()
      const documents = allNodes.map(node => ({
        id: node.id,
        content: `${node.feature.description} ${node.metadata?.path || ''} ${node.metadata?.entityType || ''}`,
        metadata: {
          entityType: node.metadata?.entityType,
          path: node.metadata?.path,
        },
      }))

      await search.indexBatch(documents)

      // Search for encoder-related entities
      const results = await search.search('encoder', 10)
      expect(results.length).toBeGreaterThan(0)

      // Verify we indexed classes and methods (encoder.ts has class + methods)
      const nodeTypes = allNodes.map(n => n.metadata?.entityType)
      expect(nodeTypes).toContain('class')
      expect(nodeTypes).toContain('method')

      // Verify search returns results from our indexed documents
      for (const r of results) {
        expect(r.id).toBeDefined()
        expect(r.content).toBeDefined()
      }
    })
  })

  describe('performance', () => {
    it('should encode large codebase efficiently', async () => {
      const encoder = new RPGEncoder(PROJECT_ROOT, {
        include: ['src/**/*.ts'],
        exclude: ['**/node_modules/**', '**/dist/**'],
      })

      const start = Date.now()
      const result = await encoder.encode()
      const duration = Date.now() - start

      // Should complete in reasonable time (< 30s)
      expect(duration).toBeLessThan(30000)

      // Log performance metrics (useful for monitoring)
      console.log('E2E Performance:')
      console.log(`  Files processed: ${result.filesProcessed}`)
      console.log(`  Entities extracted: ${result.entitiesExtracted}`)
      console.log(`  Duration: ${duration}ms`)
      console.log(`  Nodes: ${(await result.rpg.getNodes()).length}`)
      console.log(
        `  Edges: ${(await result.rpg.getFunctionalEdges()).length + (await result.rpg.getDependencyEdges()).length}`,
      )
    })
  })
})
