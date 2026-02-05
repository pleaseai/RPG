import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { RepositoryPlanningGraph } from '../src/graph'
import {
  encodeFailedError,
  invalidInputError,
  invalidPathError,
  nodeNotFoundError,
  RPGError,
  RPGErrorCode,
  rpgNotLoadedError,
} from '../src/mcp/errors'
import {
  EncodeInputSchema,
  executeExplore,
  executeFetch,
  executeSearch,
  executeStats,
  ExploreInputSchema,
  FetchInputSchema,
  SearchInputSchema,
  StatsInputSchema,
} from '../src/mcp/tools'

describe('mCP Tool Schemas', () => {
  describe('searchInputSchema', () => {
    it('should accept valid search input with all fields', () => {
      const input = {
        mode: 'features',
        featureTerms: ['authentication', 'login'],
        filePattern: '*.ts',
      }
      const result = SearchInputSchema.parse(input)
      expect(result.mode).toBe('features')
      expect(result.featureTerms).toEqual(['authentication', 'login'])
      expect(result.filePattern).toBe('*.ts')
    })

    it('should apply default mode when not provided', () => {
      const input = {}
      const result = SearchInputSchema.parse(input)
      expect(result.mode).toBe('auto')
    })

    it('should accept snippets mode', () => {
      const input = { mode: 'snippets', filePattern: 'src/**/*.ts' }
      const result = SearchInputSchema.parse(input)
      expect(result.mode).toBe('snippets')
    })

    it('should reject invalid mode', () => {
      const input = { mode: 'invalid' }
      expect(() => SearchInputSchema.parse(input)).toThrow()
    })
  })

  describe('fetchInputSchema', () => {
    it('should accept valid fetch input', () => {
      const input = {
        codeEntities: ['file1.ts', 'class::MyClass'],
        featureEntities: ['authentication'],
      }
      const result = FetchInputSchema.parse(input)
      expect(result.codeEntities).toEqual(['file1.ts', 'class::MyClass'])
      expect(result.featureEntities).toEqual(['authentication'])
    })

    it('should reject empty input (requires at least one entity type)', () => {
      const input = {}
      expect(() => FetchInputSchema.parse(input)).toThrow()
    })

    it('should accept input with only codeEntities', () => {
      const input = { codeEntities: ['file1.ts'] }
      const result = FetchInputSchema.parse(input)
      expect(result.codeEntities).toEqual(['file1.ts'])
    })

    it('should accept input with only featureEntities', () => {
      const input = { featureEntities: ['auth'] }
      const result = FetchInputSchema.parse(input)
      expect(result.featureEntities).toEqual(['auth'])
    })
  })

  describe('exploreInputSchema', () => {
    it('should accept valid explore input with all fields', () => {
      const input = {
        startNode: 'node1',
        edgeType: 'functional',
        maxDepth: 5,
        direction: 'both',
      }
      const result = ExploreInputSchema.parse(input)
      expect(result.startNode).toBe('node1')
      expect(result.edgeType).toBe('functional')
      expect(result.maxDepth).toBe(5)
      expect(result.direction).toBe('both')
    })

    it('should apply defaults for optional fields', () => {
      const input = { startNode: 'node1' }
      const result = ExploreInputSchema.parse(input)
      expect(result.edgeType).toBe('both')
      expect(result.maxDepth).toBe(3)
      expect(result.direction).toBe('out')
    })

    it('should require startNode', () => {
      const input = {}
      expect(() => ExploreInputSchema.parse(input)).toThrow()
    })
  })

  describe('encodeInputSchema', () => {
    it('should accept valid encode input', () => {
      const input = {
        repoPath: '/path/to/repo',
        includeSource: true,
        outputPath: '/output/rpg.json',
      }
      const result = EncodeInputSchema.parse(input)
      expect(result.repoPath).toBe('/path/to/repo')
      expect(result.includeSource).toBe(true)
      expect(result.outputPath).toBe('/output/rpg.json')
    })

    it('should apply default includeSource', () => {
      const input = { repoPath: '/path/to/repo' }
      const result = EncodeInputSchema.parse(input)
      expect(result.includeSource).toBe(false)
    })

    it('should require repoPath', () => {
      const input = {}
      expect(() => EncodeInputSchema.parse(input)).toThrow()
    })
  })

  describe('statsInputSchema', () => {
    it('should accept empty input', () => {
      const input = {}
      const result = StatsInputSchema.parse(input)
      expect(result).toEqual({})
    })
  })
})

describe('mCP Error Handling', () => {
  describe('rPGError', () => {
    it('should create error with code and message', () => {
      const error = new RPGError(RPGErrorCode.RPG_NOT_LOADED, 'Test message')
      expect(error.code).toBe(RPGErrorCode.RPG_NOT_LOADED)
      expect(error.message).toBe('Test message')
      expect(error.name).toBe('RPGError')
    })
  })

  describe('error factory functions', () => {
    it('should create rpgNotLoadedError', () => {
      const error = rpgNotLoadedError()
      expect(error.code).toBe(RPGErrorCode.RPG_NOT_LOADED)
      expect(error.message).toContain('not loaded')
    })

    it('should create nodeNotFoundError', () => {
      const error = nodeNotFoundError('test-node')
      expect(error.code).toBe(RPGErrorCode.NODE_NOT_FOUND)
      expect(error.message).toContain('test-node')
    })

    it('should create invalidPathError', () => {
      const error = invalidPathError('/invalid/path')
      expect(error.code).toBe(RPGErrorCode.INVALID_PATH)
      expect(error.message).toContain('/invalid/path')
    })

    it('should create encodeFailedError', () => {
      const error = encodeFailedError('reason')
      expect(error.code).toBe(RPGErrorCode.ENCODE_FAILED)
      expect(error.message).toContain('reason')
    })

    it('should create invalidInputError', () => {
      const error = invalidInputError('bad input')
      expect(error.code).toBe(RPGErrorCode.INVALID_INPUT)
      expect(error.message).toContain('bad input')
    })
  })
})

describe('mCP Tool Execution', () => {
  let rpg: RepositoryPlanningGraph

  beforeEach(async () => {
    // Load sample RPG fixture
    const fixturePath = join(__dirname, 'fixtures', 'sample-rpg.json')
    const content = await readFile(fixturePath, 'utf-8')
    rpg = await RepositoryPlanningGraph.fromJSON(content)
  })

  describe('executeSearch', () => {
    it('should throw when RPG is null', async () => {
      await expect(executeSearch(null, { mode: 'auto' })).rejects.toThrow(RPGError)
    })

    it('should search by feature terms', async () => {
      const result = await executeSearch(rpg, {
        mode: 'features',
        featureTerms: ['math'],
      })
      expect(result.nodes.length).toBeGreaterThan(0)
      expect(result.mode).toBe('features')
    })

    it('should search by file pattern', async () => {
      const result = await executeSearch(rpg, {
        mode: 'snippets',
        filePattern: 'utils/.*',
      })
      expect(result.nodes.length).toBeGreaterThan(0)
      expect(result.mode).toBe('snippets')
    })

    it('should handle auto mode', async () => {
      const result = await executeSearch(rpg, {
        mode: 'auto',
        featureTerms: ['string'],
        filePattern: '*.ts',
      })
      expect(result.mode).toBe('auto')
    })
  })

  describe('executeFetch', () => {
    it('should throw when RPG is null', async () => {
      await expect(executeFetch(null, { codeEntities: ['test'] })).rejects.toThrow(RPGError)
    })

    it('should fetch existing entities', async () => {
      const result = await executeFetch(rpg, {
        codeEntities: ['utils/math.ts'],
      })
      expect(result.entities.length).toBe(1)
      expect(result.entities[0]?.node.id).toBe('utils/math.ts')
      expect(result.notFound).toEqual([])
    })

    it('should report not found entities', async () => {
      const result = await executeFetch(rpg, {
        codeEntities: ['nonexistent'],
      })
      expect(result.entities.length).toBe(0)
      expect(result.notFound).toContain('nonexistent')
    })

    it('should handle mixed found and not found', async () => {
      const result = await executeFetch(rpg, {
        codeEntities: ['utils/math.ts', 'nonexistent'],
      })
      expect(result.entities.length).toBe(1)
      expect(result.notFound).toContain('nonexistent')
    })
  })

  describe('executeExplore', () => {
    it('should throw when RPG is null', async () => {
      await expect(
        executeExplore(null, { startNode: 'root', edgeType: 'both', maxDepth: 3, direction: 'out' }),
      ).rejects.toThrow(RPGError)
    })

    it('should throw when start node not found', async () => {
      await expect(
        executeExplore(rpg, {
          startNode: 'nonexistent',
          edgeType: 'both',
          maxDepth: 3,
          direction: 'out',
        }),
      ).rejects.toThrow(RPGError)
    })

    it('should explore from root node', async () => {
      const result = await executeExplore(rpg, {
        startNode: 'root',
        edgeType: 'functional',
        maxDepth: 2,
        direction: 'out',
      })
      expect(result.nodes.length).toBeGreaterThan(0)
      expect(result.edges.length).toBeGreaterThan(0)
    })

    it('should respect maxDepth', async () => {
      const shallow = await executeExplore(rpg, {
        startNode: 'root',
        edgeType: 'functional',
        maxDepth: 1,
        direction: 'out',
      })
      const deep = await executeExplore(rpg, {
        startNode: 'root',
        edgeType: 'functional',
        maxDepth: 3,
        direction: 'out',
      })
      expect(deep.nodes.length).toBeGreaterThanOrEqual(shallow.nodes.length)
    })
  })

  describe('executeStats', () => {
    it('should throw when RPG is null', async () => {
      await expect(executeStats(null)).rejects.toThrow(RPGError)
    })

    it('should return graph statistics', async () => {
      const result = await executeStats(rpg)
      expect(result.name).toBe('sample-project')
      expect(result.nodeCount).toBeGreaterThan(0)
      expect(result.edgeCount).toBeGreaterThan(0)
      expect(result.highLevelNodeCount).toBeGreaterThan(0)
      expect(result.lowLevelNodeCount).toBeGreaterThan(0)
    })
  })
})
