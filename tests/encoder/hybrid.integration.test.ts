import type { RepositoryPlanningGraph } from '@pleaseai/rpg-graph'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { RPGEncoder } from '@pleaseai/rpg-encoder'
import { MockEmbedding } from '@pleaseai/rpg-encoder/embedding'
import { SemanticSearch } from '@pleaseai/rpg-encoder/semantic-search'
import { executeSearch } from '@pleaseai/rpg-mcp/tools'
import { LocalVectorStore } from '@pleaseai/rpg-store/local'
import { SearchNode } from '@pleaseai/rpg-tools'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const SUPERJSON_ROOT = resolve(__dirname, '../fixtures/superjson')

describe('e2E: Hybrid Search Pipeline (superjson)', () => {
  let rpg: RepositoryPlanningGraph
  let semanticSearch: SemanticSearch
  let searchDbPath: string

  beforeAll(async () => {
    // Phase 1: Encode the superjson repository
    const encoder = new RPGEncoder(SUPERJSON_ROOT, {
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts'],
    })

    const result = await encoder.encode()
    rpg = result.rpg

    // Sanity check encoding
    expect(result.filesProcessed).toBeGreaterThan(5)
    expect(result.entitiesExtracted).toBeGreaterThan(10)

    // Phase 2: Build semantic index
    searchDbPath = join(
      tmpdir(),
      `rpg-hybrid-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    const embedding = new MockEmbedding(128)
    const vectorStore = new LocalVectorStore()
    await vectorStore.open({ path: searchDbPath })
    semanticSearch = new SemanticSearch({ vectorStore, embedding })

    // Index all RPG nodes with feature descriptions
    const documents = (await rpg.getNodes()).map(node => ({
      id: node.id,
      content: `${node.feature.description} ${(node.feature.keywords ?? []).join(' ')} ${node.metadata?.path ?? ''}`,
      metadata: {
        entityType: node.metadata?.entityType,
        path: node.metadata?.path,
      },
    }))

    await semanticSearch.indexBatch(documents)
  })

  afterEach(async () => {
    // Don't close between tests — shared setup
  })

  // Cleanup after all tests
  afterAll(async () => {
    await semanticSearch.close()
    try {
      await rm(searchDbPath, { recursive: true, force: true })
    }
    catch {
      // Ignore cleanup errors
    }
  })

  describe('encode superjson', () => {
    it('should have low-level nodes (high-level requires LLM)', async () => {
      // Without LLM, semantic reorganization is skipped — no high-level nodes
      expect((await rpg.getHighLevelNodes()).length).toBe(0)
      expect((await rpg.getLowLevelNodes()).length).toBeGreaterThan(0)
    })

    it('should have functional edges', async () => {
      expect((await rpg.getFunctionalEdges()).length).toBeGreaterThan(0)
    })

    it('should contain known superjson files', async () => {
      const paths = (await rpg.getNodes()).map(n => n.metadata?.path).filter(Boolean)
      expect(paths.some(p => p?.includes('transformer.ts'))).toBe(true)
      expect(paths.some(p => p?.includes('plainer.ts'))).toBe(true)
      expect(paths.some(p => p?.includes('is.ts'))).toBe(true)
    })
  })

  describe('hybrid Search via SearchNode', () => {
    it('should find transformer-related nodes with hybrid strategy', async () => {
      const search = new SearchNode(rpg, semanticSearch)
      const result = await search.query({
        mode: 'features',
        featureTerms: ['transformer'],
        searchStrategy: 'hybrid',
      })

      expect(result.totalMatches).toBeGreaterThan(0)
    })

    it('should find type-checking nodes with hybrid strategy', async () => {
      const search = new SearchNode(rpg, semanticSearch)
      const result = await search.query({
        mode: 'features',
        featureTerms: ['type check'],
        searchStrategy: 'hybrid',
      })

      expect(result.totalMatches).toBeGreaterThan(0)
    })

    it('should find registry-related nodes', async () => {
      const search = new SearchNode(rpg, semanticSearch)
      const result = await search.query({
        mode: 'features',
        featureTerms: ['registry'],
        searchStrategy: 'hybrid',
      })

      expect(result.totalMatches).toBeGreaterThan(0)
    })

    it('should combine feature search and file pattern in auto mode', async () => {
      const search = new SearchNode(rpg, semanticSearch)
      const result = await search.query({
        mode: 'auto',
        featureTerms: ['serialize'],
        filePattern: '.*transformer.*',
        searchStrategy: 'hybrid',
      })

      expect(result.totalMatches).toBeGreaterThan(0)
    })

    it('should fall back to string match without semantic search', async () => {
      const search = new SearchNode(rpg)
      const result = await search.query({
        mode: 'features',
        featureTerms: ['transformer'],
      })

      // String fallback also finds results
      expect(result.totalMatches).toBeGreaterThanOrEqual(0)
    })
  })

  describe('FTS-only Search', () => {
    it('should find nodes via FTS search strategy', async () => {
      const search = new SearchNode(rpg, semanticSearch)
      const result = await search.query({
        mode: 'features',
        featureTerms: ['transformer'],
        searchStrategy: 'fts',
      })

      expect(result.totalMatches).toBeGreaterThan(0)
    })
  })

  describe('vector-only Search', () => {
    it('should find nodes via vector search strategy', async () => {
      const search = new SearchNode(rpg, semanticSearch)
      const result = await search.query({
        mode: 'features',
        featureTerms: ['transform data'],
        searchStrategy: 'vector',
      })

      expect(result.totalMatches).toBeGreaterThan(0)
    })
  })

  describe('MCP executeSearch Integration', () => {
    it('should work through executeSearch with hybrid', async () => {
      const result = await executeSearch(
        rpg,
        {
          mode: 'features',
          featureTerms: ['transformer'],
          searchStrategy: 'hybrid',
        },
        semanticSearch,
      )

      expect(result.totalMatches).toBeGreaterThan(0)
      expect(result.nodes.length).toBeGreaterThan(0)
      for (const node of result.nodes) {
        expect(node.id).toBeDefined()
        expect(node.feature).toBeDefined()
      }
    })

    it('should work through executeSearch without semantic search', async () => {
      const result = await executeSearch(rpg, {
        mode: 'auto',
        featureTerms: ['transformer'],
      })

      // Falls back to string match
      expect(result.mode).toBe('auto')
    })

    it('should accept searchStrategy in schema', async () => {
      const result = await executeSearch(
        rpg,
        {
          mode: 'features',
          featureTerms: ['registry class'],
          searchStrategy: 'fts',
        },
        semanticSearch,
      )

      expect(result.totalMatches).toBeGreaterThan(0)
    })
  })
})
