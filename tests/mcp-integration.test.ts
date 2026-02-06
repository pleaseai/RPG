import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { RepositoryPlanningGraph } from '../src/graph'
import { createMcpServer, loadRPG } from '../src/mcp/server'
import { executeExplore, executeFetch, executeSearch, executeStats } from '../src/mcp/tools'

describe('MCP Integration Tests', () => {
  let rpg: RepositoryPlanningGraph

  beforeAll(async () => {
    const fixturePath = join(__dirname, 'fixtures', 'sample-rpg.json')
    rpg = await loadRPG(fixturePath)
  })

  describe('loadRPG', () => {
    it('should load RPG from file path', async () => {
      expect(rpg).toBeInstanceOf(RepositoryPlanningGraph)
      expect(rpg.getConfig().name).toBe('sample-project')
    })

    it('should throw for invalid file path', async () => {
      await expect(loadRPG('/nonexistent/path.json')).rejects.toThrow()
    })
  })

  describe('createMcpServer', () => {
    it('should create server with RPG', () => {
      const server = createMcpServer(rpg)
      expect(server).toBeDefined()
    })

    it('should create server without RPG', () => {
      const server = createMcpServer(null)
      expect(server).toBeDefined()
    })
  })

  describe('full workflow integration', () => {
    it('should search, fetch, and explore in sequence', async () => {
      // Step 1: Search for math-related nodes
      const searchResult = await executeSearch(rpg, {
        mode: 'features',
        featureTerms: ['math'],
      })
      expect(searchResult.nodes.length).toBeGreaterThan(0)

      // Step 2: Fetch the first result
      const firstNodeId = searchResult.nodes[0]?.id
      expect(firstNodeId).toBeDefined()

      const fetchResult = await executeFetch(rpg, {
        codeEntities: [firstNodeId as string],
      })
      expect(fetchResult.entities.length).toBe(1)
      expect(fetchResult.entities[0]?.sourceCode).toBeDefined()

      // Step 3: Explore from the utils module
      const exploreResult = await executeExplore(rpg, {
        startNode: 'utils',
        edgeType: 'functional',
        maxDepth: 2,
        direction: 'out',
      })
      expect(exploreResult.nodes.length).toBeGreaterThan(0)
      expect(exploreResult.edges.length).toBeGreaterThan(0)
    })

    it('should get accurate stats for sample RPG', async () => {
      const stats = await executeStats(rpg)

      // Verify against known sample-rpg.json structure
      expect(stats.name).toBe('sample-project')
      expect(stats.nodeCount).toBe(6) // root, utils, services, 3 files
      expect(stats.edgeCount).toBe(6) // 5 functional + 1 dependency
      expect(stats.highLevelNodeCount).toBe(3) // root, utils, services
      expect(stats.lowLevelNodeCount).toBe(3) // 3 files
      expect(stats.functionalEdgeCount).toBe(5)
      expect(stats.dependencyEdgeCount).toBe(1)
    })
  })

  describe('graph traversal patterns', () => {
    it('should find all children of utils module', async () => {
      const result = await executeExplore(rpg, {
        startNode: 'utils',
        edgeType: 'functional',
        maxDepth: 1,
        direction: 'out',
      })

      // utils has 2 children: math.ts and string.ts
      const childIds = result.nodes.filter(n => n.id !== 'utils').map(n => n.id)
      expect(childIds).toContain('utils/math.ts')
      expect(childIds).toContain('utils/string.ts')
    })

    it('should find dependency between calculator and math', async () => {
      const result = await executeExplore(rpg, {
        startNode: 'services/calculator.ts',
        edgeType: 'dependency',
        maxDepth: 1,
        direction: 'out',
      })

      const dependencyTargets = result.edges
        .filter(e => e.source === 'services/calculator.ts')
        .map(e => e.target)
      expect(dependencyTargets).toContain('utils/math.ts')
    })

    it('should find reverse dependency (who depends on math)', async () => {
      const result = await executeExplore(rpg, {
        startNode: 'utils/math.ts',
        edgeType: 'dependency',
        maxDepth: 1,
        direction: 'in',
      })

      const dependents = result.edges
        .filter(e => e.target === 'utils/math.ts')
        .map(e => e.source)
      expect(dependents).toContain('services/calculator.ts')
    })
  })

  describe('search modes', () => {
    it('should find nodes by feature keywords', async () => {
      const result = await executeSearch(rpg, {
        mode: 'features',
        featureTerms: ['string', 'manipulation'],
      })

      const ids = result.nodes.map(n => n.id)
      expect(ids).toContain('utils/string.ts')
    })

    it('should find nodes by file pattern', async () => {
      const result = await executeSearch(rpg, {
        mode: 'snippets',
        filePattern: 'services/.*',
      })

      const ids = result.nodes.map(n => n.id)
      expect(ids).toContain('services/calculator.ts')
    })

    it('should combine search modes in auto', async () => {
      const result = await executeSearch(rpg, {
        mode: 'auto',
        featureTerms: ['utility'],
        filePattern: 'utils/.*',
      })

      expect(result.mode).toBe('auto')
      expect(result.nodes.length).toBeGreaterThan(0)
    })
  })

  describe('fetch entity details', () => {
    it('should return source code for low-level nodes', async () => {
      const result = await executeFetch(rpg, {
        codeEntities: ['utils/math.ts'],
      })

      expect(result.entities.length).toBe(1)
      const entity = result.entities[0]
      expect(entity?.sourceCode).toContain('function add')
      expect(entity?.sourceCode).toContain('function multiply')
    })

    it('should return feature paths', async () => {
      const result = await executeFetch(rpg, {
        codeEntities: ['utils/math.ts'],
      })

      const entity = result.entities[0]
      expect(entity?.featurePaths.length).toBeGreaterThan(0)
    })

    it('should handle multiple entities', async () => {
      const result = await executeFetch(rpg, {
        codeEntities: ['utils/math.ts', 'utils/string.ts', 'nonexistent'],
      })

      expect(result.entities.length).toBe(2)
      expect(result.notFound).toContain('nonexistent')
    })
  })
})
