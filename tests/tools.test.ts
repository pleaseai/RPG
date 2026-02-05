import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MockEmbedding } from '../src/encoder/embedding'
import { SemanticSearch } from '../src/encoder/semantic-search'
import { RepositoryPlanningGraph } from '../src/graph'
import { ExploreRPG, FetchNode, SearchNode } from '../src/tools'

describe('searchNode', () => {
  let rpg: RepositoryPlanningGraph
  let search: SearchNode

  beforeEach(async () => {
    rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })

    // Add test nodes
    await rpg.addHighLevelNode({
      id: 'auth-module',
      feature: {
        description: 'handle user authentication',
        keywords: ['auth', 'login', 'security'],
      },
      directoryPath: '/src/auth',
    })

    await rpg.addHighLevelNode({
      id: 'data-module',
      feature: {
        description: 'process and transform data',
        keywords: ['data', 'transform', 'etl'],
      },
      directoryPath: '/src/data',
    })

    await rpg.addLowLevelNode({
      id: 'login-func',
      feature: {
        description: 'validate user credentials',
        keywords: ['validate', 'credentials'],
      },
      metadata: {
        entityType: 'function',
        path: '/src/auth/login.ts',
        startLine: 10,
        endLine: 30,
      },
    })

    await rpg.addLowLevelNode({
      id: 'logout-func',
      feature: {
        description: 'terminate user session',
        keywords: ['session', 'logout'],
      },
      metadata: {
        entityType: 'function',
        path: '/src/auth/logout.ts',
        startLine: 5,
        endLine: 15,
      },
    })

    await rpg.addFunctionalEdge({ source: 'auth-module', target: 'login-func' })
    await rpg.addFunctionalEdge({ source: 'auth-module', target: 'logout-func' })

    search = new SearchNode(rpg)
  })

  it('searches by feature terms', async () => {
    const results = await search.query({
      mode: 'features',
      featureTerms: ['authentication'],
    })

    expect(results.totalMatches).toBe(1)
    expect(results.nodes[0]?.id).toBe('auth-module')
  })

  it('searches by multiple feature terms', async () => {
    const results = await search.query({
      mode: 'features',
      featureTerms: ['auth', 'data'],
    })

    expect(results.totalMatches).toBe(2)
  })

  it('searches by keywords', async () => {
    const results = await search.query({
      mode: 'features',
      featureTerms: ['login'],
    })

    expect(results.totalMatches).toBeGreaterThanOrEqual(1)
  })

  it('searches by file pattern', async () => {
    const results = await search.query({
      mode: 'snippets',
      filePattern: '/src/auth/%',
    })

    expect(results.totalMatches).toBe(2)
  })

  it('auto mode searches both features and snippets', async () => {
    const results = await search.query({
      mode: 'auto',
      featureTerms: ['validate'],
      filePattern: '/src/auth/login%',
    })

    expect(results.totalMatches).toBeGreaterThanOrEqual(1)
  })

  it('returns empty for no matches', async () => {
    const results = await search.query({
      mode: 'features',
      featureTerms: ['nonexistent-feature'],
    })

    expect(results.totalMatches).toBe(0)
    expect(results.nodes).toHaveLength(0)
  })
})

describe('searchNode with SemanticSearch', () => {
  let rpg: RepositoryPlanningGraph
  let semanticSearch: SemanticSearch
  let search: SearchNode
  let testDbPath: string

  beforeEach(async () => {
    testDbPath = join(
      tmpdir(),
      `rpg-search-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )

    rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })

    await rpg.addHighLevelNode({
      id: 'auth-module',
      feature: {
        description: 'handle user authentication',
        keywords: ['auth', 'login', 'security'],
      },
      directoryPath: '/src/auth',
    })

    await rpg.addLowLevelNode({
      id: 'login-func',
      feature: {
        description: 'validate user credentials',
        keywords: ['validate', 'credentials'],
      },
      metadata: {
        entityType: 'function',
        path: '/src/auth/login.ts',
        startLine: 10,
        endLine: 30,
      },
    })

    await rpg.addFunctionalEdge({ source: 'auth-module', target: 'login-func' })

    // Set up semantic search with mock embeddings
    const embedding = new MockEmbedding(64)
    semanticSearch = new SemanticSearch({
      dbPath: testDbPath,
      tableName: 'test_search_nodes',
      embedding,
    })

    // Index the RPG nodes
    await semanticSearch.indexBatch([
      { id: 'auth-module', content: 'handle user authentication' },
      { id: 'login-func', content: 'validate user credentials' },
    ])

    search = new SearchNode(rpg, semanticSearch)
  })

  afterEach(async () => {
    await semanticSearch.close()
    try {
      await rm(testDbPath, { recursive: true, force: true })
    }
    catch {
      // Ignore cleanup errors
    }
  })

  it('uses hybrid search when semanticSearch is available', async () => {
    const results = await search.query({
      mode: 'features',
      featureTerms: ['authentication'],
    })

    expect(results.totalMatches).toBeGreaterThan(0)
  })

  it('respects explicit string strategy', async () => {
    const results = await search.query({
      mode: 'features',
      featureTerms: ['authentication'],
      searchStrategy: 'string',
    })

    // String match should find 'auth-module' (contains 'authentication')
    expect(results.totalMatches).toBe(1)
    expect(results.nodes[0]?.id).toBe('auth-module')
  })

  it('works with fts strategy', async () => {
    const results = await search.query({
      mode: 'features',
      featureTerms: ['authentication'],
      searchStrategy: 'fts',
    })

    expect(results.totalMatches).toBeGreaterThan(0)
  })

  it('works with vector strategy', async () => {
    const results = await search.query({
      mode: 'features',
      featureTerms: ['authentication'],
      searchStrategy: 'vector',
    })

    expect(results.totalMatches).toBeGreaterThan(0)
  })
})

describe('searchNode fallback without SemanticSearch', () => {
  let rpg: RepositoryPlanningGraph
  let search: SearchNode

  beforeEach(async () => {
    rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })
    await rpg.addHighLevelNode({
      id: 'auth-module',
      feature: {
        description: 'handle user authentication',
        keywords: ['auth'],
      },
      directoryPath: '/src/auth',
    })

    // No semantic search passed — should fall back to string match
    search = new SearchNode(rpg)
  })

  it('falls back to string match when no semanticSearch', async () => {
    const results = await search.query({
      mode: 'features',
      featureTerms: ['authentication'],
    })

    expect(results.totalMatches).toBe(1)
    expect(results.nodes[0]?.id).toBe('auth-module')
  })

  it('falls back to string match even when hybrid strategy requested', async () => {
    const results = await search.query({
      mode: 'features',
      featureTerms: ['authentication'],
      searchStrategy: 'hybrid',
    })

    // Should still work via fallback
    expect(results.totalMatches).toBe(1)
  })
})

describe('fetchNode', () => {
  let rpg: RepositoryPlanningGraph
  let fetch: FetchNode

  beforeEach(async () => {
    rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })

    await rpg.addHighLevelNode({
      id: 'root',
      feature: { description: 'root module' },
    })

    await rpg.addHighLevelNode({
      id: 'child',
      feature: { description: 'child module' },
    })

    await rpg.addLowLevelNode({
      id: 'func',
      feature: { description: 'test function' },
      metadata: {
        entityType: 'function',
        path: '/src/test.ts',
        startLine: 1,
        endLine: 10,
      },
      sourceCode: 'function test() { return true; }',
    })

    await rpg.addFunctionalEdge({ source: 'root', target: 'child' })
    await rpg.addFunctionalEdge({ source: 'child', target: 'func' })

    fetch = new FetchNode(rpg)
  })

  it('fetches existing entities', async () => {
    const result = await fetch.get({
      codeEntities: ['func'],
    })

    expect(result.entities).toHaveLength(1)
    expect(result.notFound).toHaveLength(0)
    expect(result.entities[0]?.node.id).toBe('func')
    expect(result.entities[0]?.sourceCode).toBe('function test() { return true; }')
  })

  it('returns not found for missing entities', async () => {
    const result = await fetch.get({
      codeEntities: ['nonexistent'],
    })

    expect(result.entities).toHaveLength(0)
    expect(result.notFound).toHaveLength(1)
    expect(result.notFound[0]).toBe('nonexistent')
  })

  it('handles mixed existing and missing entities', async () => {
    const result = await fetch.get({
      codeEntities: ['func', 'nonexistent', 'root'],
    })

    expect(result.entities).toHaveLength(2)
    expect(result.notFound).toHaveLength(1)
  })

  it('returns feature paths', async () => {
    const result = await fetch.get({
      codeEntities: ['func'],
    })

    expect(result.entities[0]?.featurePaths).toBeDefined()
    expect(result.entities[0]?.featurePaths.length).toBeGreaterThan(0)
  })
})

describe('exploreRPG', () => {
  let rpg: RepositoryPlanningGraph
  let explore: ExploreRPG

  beforeEach(async () => {
    rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })

    // Create a graph structure:
    // root -> moduleA -> funcA1, funcA2
    //      -> moduleB -> funcB1
    // funcA1 imports funcB1 (dependency)

    await rpg.addHighLevelNode({ id: 'root', feature: { description: 'root' } })
    await rpg.addHighLevelNode({ id: 'moduleA', feature: { description: 'module A' } })
    await rpg.addHighLevelNode({ id: 'moduleB', feature: { description: 'module B' } })

    await rpg.addLowLevelNode({
      id: 'funcA1',
      feature: { description: 'function A1' },
      metadata: { entityType: 'function', path: '/a/a1.ts' },
    })
    await rpg.addLowLevelNode({
      id: 'funcA2',
      feature: { description: 'function A2' },
      metadata: { entityType: 'function', path: '/a/a2.ts' },
    })
    await rpg.addLowLevelNode({
      id: 'funcB1',
      feature: { description: 'function B1' },
      metadata: { entityType: 'function', path: '/b/b1.ts' },
    })

    // Functional edges (hierarchy)
    await rpg.addFunctionalEdge({ source: 'root', target: 'moduleA' })
    await rpg.addFunctionalEdge({ source: 'root', target: 'moduleB' })
    await rpg.addFunctionalEdge({ source: 'moduleA', target: 'funcA1' })
    await rpg.addFunctionalEdge({ source: 'moduleA', target: 'funcA2' })
    await rpg.addFunctionalEdge({ source: 'moduleB', target: 'funcB1' })

    // Dependency edge
    await rpg.addDependencyEdge({
      source: 'funcA1',
      target: 'funcB1',
      dependencyType: 'import',
    })

    explore = new ExploreRPG(rpg)
  })

  it('explores functional edges outward', async () => {
    const result = await explore.traverse({
      startNode: 'root',
      edgeType: 'functional',
      maxDepth: 1,
      direction: 'out',
    })

    expect(result.nodes.length).toBe(3) // root, moduleA, moduleB
    expect(result.maxDepthReached).toBe(1)
  })

  it('explores functional edges with deeper depth', async () => {
    const result = await explore.traverse({
      startNode: 'root',
      edgeType: 'functional',
      maxDepth: 2,
      direction: 'out',
    })

    expect(result.nodes.length).toBe(6) // all nodes
    expect(result.maxDepthReached).toBe(2)
  })

  it('explores dependency edges', async () => {
    const result = await explore.traverse({
      startNode: 'funcA1',
      edgeType: 'dependency',
      maxDepth: 1,
      direction: 'out',
    })

    expect(result.nodes.length).toBe(2) // funcA1, funcB1
    expect(result.edges.some(e => e.target === 'funcB1')).toBe(true)
  })

  it('explores both edge types', async () => {
    const result = await explore.traverse({
      startNode: 'moduleA',
      edgeType: 'both',
      maxDepth: 2,
      direction: 'out',
    })

    // moduleA -> funcA1, funcA2, funcA1 -> funcB1
    expect(result.nodes.length).toBeGreaterThanOrEqual(3)
  })

  it('explores inward direction', async () => {
    const result = await explore.traverse({
      startNode: 'funcA1',
      edgeType: 'functional',
      maxDepth: 2,
      direction: 'in',
    })

    // funcA1 <- moduleA <- root
    expect(result.nodes.some(n => n.id === 'moduleA')).toBe(true)
    expect(result.nodes.some(n => n.id === 'root')).toBe(true)
  })

  it('respects max depth limit', async () => {
    const result = await explore.traverse({
      startNode: 'root',
      edgeType: 'functional',
      maxDepth: 0,
      direction: 'out',
    })

    expect(result.nodes.length).toBe(1) // only root
    expect(result.maxDepthReached).toBe(0)
  })

  it('handles nonexistent start node', async () => {
    const result = await explore.traverse({
      startNode: 'nonexistent',
      edgeType: 'functional',
      maxDepth: 2,
      direction: 'out',
    })

    expect(result.nodes).toHaveLength(0)
  })
})
