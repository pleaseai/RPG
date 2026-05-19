import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockEmbedding } from '@pleaseai/soop-encoder/embedding'
import { SemanticSearch } from '@pleaseai/soop-encoder/semantic-search'
import { RepositoryPlanningGraph } from '@pleaseai/soop-graph'
import { LocalVectorStore } from '@pleaseai/soop-store/local'
import { ExploreRPG, FetchNode, RPGTree, SearchNode, SYNTHETIC_ROOT_ID } from '@pleaseai/soop-tools'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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

  it('auto mode without featureTerms falls back to snippet search', async () => {
    const results = await search.query({
      mode: 'auto',
      filePattern: '/src/auth/%',
    })

    // No featureTerms provided, so feature search returns empty
    // Snippet fallback runs and finds auth files by path
    expect(results.totalMatches).toBeGreaterThanOrEqual(1)
    expect(results.nodes.some(n => n.metadata?.path?.startsWith('/src/auth/'))).toBe(true)
  })

  it('auto mode uses staged fallback (feature first, then snippet)', async () => {
    const results = await search.query({
      mode: 'auto',
      featureTerms: ['validate'],
      filePattern: '/src/auth/login%',
    })

    // Feature search finds 'login-func' (validate user credentials)
    // Since feature results are not empty, snippet search is skipped
    expect(results.totalMatches).toBeGreaterThanOrEqual(1)
    expect(results.nodes.some(n => n.id === 'login-func')).toBe(true)
  })

  it('auto mode skips snippet search when feature results are sufficient', async () => {
    // Feature search for 'validate' returns 'login-func'
    // Snippet search for '/src/auth/logout%' would return 'logout-func'
    // But with staged fallback, snippet search should be skipped since feature results are non-empty
    const results = await search.query({
      mode: 'auto',
      featureTerms: ['validate'],
      filePattern: '/src/auth/logout%', // This pattern would only match logout-func
    })

    // Feature search finds 'login-func', so snippet search is skipped
    // Result should only contain login-func, not logout-func
    expect(results.nodes.some(n => n.id === 'login-func')).toBe(true)
    expect(results.nodes.some(n => n.id === 'logout-func')).toBe(false)
  })

  it('auto mode falls back to snippet search when feature search returns empty', async () => {
    const results = await search.query({
      mode: 'auto',
      featureTerms: ['nonexistent-feature-xyz'],
      filePattern: '/src/auth/%',
    })

    // Feature search returns nothing, so snippet search runs
    expect(results.totalMatches).toBeGreaterThanOrEqual(1)
    // Path search for /src/auth/% should find auth files
    expect(results.nodes.some(n => n.metadata?.path?.startsWith('/src/auth/'))).toBe(true)
  })

  it('auto mode with searchScopes restricts feature search to subtree', async () => {
    // Feature search for 'auth' scoped to data-module should find nothing
    // because auth-module is not in the data-module subtree
    const results = await search.query({
      mode: 'auto',
      featureTerms: ['auth'],
      searchScopes: ['data-module'],
      filePattern: '/src/auth/%',
    })

    // Feature search finds nothing in data-module subtree
    // So snippet fallback runs and finds auth files by path
    expect(results.totalMatches).toBeGreaterThanOrEqual(1)
    expect(results.nodes.every(n => n.metadata?.path?.startsWith('/src/auth/'))).toBe(true)
  })

  it('returns empty for no matches', async () => {
    const results = await search.query({
      mode: 'features',
      featureTerms: ['nonexistent-feature'],
    })

    expect(results.totalMatches).toBe(0)
    expect(results.nodes).toHaveLength(0)
  })

  it('restricts feature search to searchScopes for string strategy', async () => {
    // Without scopes, searching "validate" should find login-func (in auth subtree)
    const allResults = await search.query({
      mode: 'features',
      featureTerms: ['validate'],
    })
    expect(allResults.totalMatches).toBeGreaterThan(0)

    // With scopes: ['data-module'], should restrict to data subtree
    // Since login-func and logout-func are under auth-module, they should be filtered out
    // But the test setup doesn't put anything under data-module, so this should return empty
    const scopedResults = await search.query({
      mode: 'features',
      featureTerms: ['validate'],
      searchScopes: ['data-module'],
    })

    // Results should be filtered to only data-module subtree
    // Since validate keyword is only in login-func/logout-func (under auth-module),
    // it should be empty when scoped to data-module
    expect(scopedResults.totalMatches).toBe(0)
  })

  it('searchScopes with subtree includes nested children', async () => {
    // auth-module -> login-func, logout-func
    // Scoping to auth-module should include its children
    const results = await search.query({
      mode: 'features',
      featureTerms: ['validate'],
      searchScopes: ['auth-module'],
    })

    // login-func is under auth-module, so it should be included
    expect(results.totalMatches).toBeGreaterThan(0)
    expect(results.nodes.some(n => n.id === 'login-func')).toBe(true)
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
    const vectorStore = new LocalVectorStore()
    await vectorStore.open({ path: testDbPath })
    semanticSearch = new SemanticSearch({ vectorStore, embedding })

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

  it('restricts semantic search results to searchScopes subtree', async () => {
    // Add a second module outside auth subtree
    await rpg.addHighLevelNode({
      id: 'data-module',
      feature: { description: 'data processing' },
      directoryPath: '/src/data',
    })

    // Without scopes, hybrid search returns auth results
    const allResults = await search.query({
      mode: 'features',
      featureTerms: ['authentication'],
    })
    expect(allResults.totalMatches).toBeGreaterThan(0)

    // With scopes restricted to data-module, auth results are filtered out
    const scopedResults = await search.query({
      mode: 'features',
      featureTerms: ['authentication'],
      searchScopes: ['data-module'],
    })
    expect(scopedResults.totalMatches).toBe(0)
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

  it('explores containment edges downstream', async () => {
    const result = await explore.traverse({
      startNode: 'root',
      edgeType: 'containment',
      maxDepth: 1,
      direction: 'downstream',
    })

    expect(result.nodes.length).toBe(3) // root, moduleA, moduleB
    expect(result.maxDepthReached).toBe(1)
  })

  it('explores containment edges with deeper depth', async () => {
    const result = await explore.traverse({
      startNode: 'root',
      edgeType: 'containment',
      maxDepth: 2,
      direction: 'downstream',
    })

    expect(result.nodes.length).toBe(6) // all nodes
    expect(result.maxDepthReached).toBe(2)
  })

  it('explores dependency edges', async () => {
    const result = await explore.traverse({
      startNode: 'funcA1',
      edgeType: 'dependency',
      maxDepth: 1,
      direction: 'downstream',
    })

    expect(result.nodes.length).toBe(2) // funcA1, funcB1
    expect(result.edges.some(e => e.target === 'funcB1')).toBe(true)
  })

  it('explores all edge types', async () => {
    const result = await explore.traverse({
      startNode: 'moduleA',
      edgeType: 'all',
      maxDepth: 2,
      direction: 'downstream',
    })

    // moduleA -> funcA1, funcA2, funcA1 -> funcB1
    expect(result.nodes.length).toBeGreaterThanOrEqual(3)
  })

  it('explores upstream direction', async () => {
    const result = await explore.traverse({
      startNode: 'funcA1',
      edgeType: 'containment',
      maxDepth: 2,
      direction: 'upstream',
    })

    // funcA1 <- moduleA <- root
    expect(result.nodes.some(n => n.id === 'moduleA')).toBe(true)
    expect(result.nodes.some(n => n.id === 'root')).toBe(true)
  })

  it('explores both directions', async () => {
    const result = await explore.traverse({
      startNode: 'moduleA',
      edgeType: 'containment',
      maxDepth: 1,
      direction: 'both',
    })

    // upstream: moduleA <- root, downstream: moduleA -> funcA1, funcA2
    expect(result.nodes.some(n => n.id === 'root')).toBe(true)
    expect(result.nodes.some(n => n.id === 'funcA1')).toBe(true)
    expect(result.nodes.some(n => n.id === 'funcA2')).toBe(true)
  })

  it('respects max depth limit', async () => {
    const result = await explore.traverse({
      startNode: 'root',
      edgeType: 'containment',
      maxDepth: 0,
      direction: 'downstream',
    })

    expect(result.nodes.length).toBe(1) // only root
    expect(result.maxDepthReached).toBe(0)
  })

  it('handles nonexistent start node', async () => {
    const result = await explore.traverse({
      startNode: 'nonexistent',
      edgeType: 'containment',
      maxDepth: 2,
      direction: 'downstream',
    })

    expect(result.nodes).toHaveLength(0)
  })
})

describe('rPGTree', () => {
  let rpg: RepositoryPlanningGraph
  let tree: RPGTree

  beforeEach(async () => {
    rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })

    // Build a small hierarchy:
    //   root -> moduleA -> funcA1
    //                  \-> funcA2
    //         \-> moduleB -> funcB1
    await rpg.addHighLevelNode({
      id: 'root',
      feature: { description: 'application root' },
      directoryPath: '/src',
    })
    await rpg.addHighLevelNode({
      id: 'moduleA',
      feature: { description: 'auth module' },
      directoryPath: '/src/auth',
    })
    await rpg.addHighLevelNode({
      id: 'moduleB',
      feature: { description: 'data module' },
      directoryPath: '/src/data',
    })
    await rpg.addLowLevelNode({
      id: 'funcA1',
      feature: { description: 'login handler' },
      metadata: { entityType: 'function', path: '/src/auth/login.ts' },
    })
    await rpg.addLowLevelNode({
      id: 'funcA2',
      feature: { description: 'logout handler' },
      metadata: { entityType: 'function', path: '/src/auth/logout.ts' },
    })
    await rpg.addLowLevelNode({
      id: 'funcB1',
      feature: { description: 'data loader' },
      metadata: { entityType: 'function', path: '/src/data/load.ts' },
    })

    await rpg.addFunctionalEdge({ source: 'root', target: 'moduleA' })
    await rpg.addFunctionalEdge({ source: 'root', target: 'moduleB' })
    await rpg.addFunctionalEdge({ source: 'moduleA', target: 'funcA1' })
    await rpg.addFunctionalEdge({ source: 'moduleA', target: 'funcA2' })
    await rpg.addFunctionalEdge({ source: 'moduleB', target: 'funcB1' })

    tree = new RPGTree(rpg)
  })

  it('returns a nested tree from a specified root', async () => {
    const result = await tree.list({ rootId: 'root', maxDepth: 2 })

    expect(result.root).not.toBeNull()
    expect(result.root!.id).toBe('root')
    expect(result.root!.children).toHaveLength(2)
    const moduleA = result.root!.children!.find(c => c.id === 'moduleA')
    expect(moduleA?.children).toHaveLength(2)
    expect(moduleA?.children?.some(c => c.id === 'funcA1')).toBe(true)
  })

  it('truncates beyond maxDepth using childrenCount', async () => {
    const result = await tree.list({ rootId: 'root', maxDepth: 1 })

    expect(result.root!.children).toHaveLength(2)
    const moduleA = result.root!.children!.find(c => c.id === 'moduleA')
    expect(moduleA?.children).toBeUndefined()
    expect(moduleA?.childrenCount).toBe(2)
  })

  it('uses the unique top-level node as default root', async () => {
    const result = await tree.list({ maxDepth: 1 })

    // Only 'root' has no incoming functional edge, so it should be the root.
    expect(result.root!.id).toBe('root')
  })

  it('falls back to a synthetic root when multiple top-level nodes exist', async () => {
    // Add another orphan top-level node
    await rpg.addHighLevelNode({
      id: 'orphan',
      feature: { description: 'orphan module' },
      directoryPath: '/src/orphan',
    })

    const result = await tree.list({ maxDepth: 1 })

    expect(result.root!.id).toBe(SYNTHETIC_ROOT_ID)
    const childIds = result.root!.children?.map(c => c.id) ?? []
    expect(childIds).toContain('root')
    expect(childIds).toContain('orphan')
  })

  it('reports subtreeNodes count when rootId is specified', async () => {
    const result = await tree.list({ rootId: 'moduleA', maxDepth: 5 })

    // moduleA + funcA1 + funcA2 = 3 nodes
    expect(result.subtreeNodes).toBe(3)
    expect(result.totalNodes).toBe(6)
  })

  it('returns suggestions when rootId is unknown', async () => {
    const result = await tree.list({ rootId: 'modulA', maxDepth: 1 })

    expect(result.root).toBeNull()
    expect(result.notFound).toBe('modulA')
    expect(result.suggestions).toBeDefined()
    // Should suggest 'moduleA' as a close fuzzy match
    expect(result.suggestions!.length).toBeGreaterThan(0)
    expect(result.suggestions).toContain('moduleA')
  })

  it('derives display name from directoryPath basename for high-level nodes', async () => {
    const result = await tree.list({ rootId: 'moduleA', maxDepth: 0 })

    expect(result.root!.name).toBe('auth')
  })

  it('derives display name from path basename for low-level nodes', async () => {
    const result = await tree.list({ rootId: 'funcA1', maxDepth: 0 })

    expect(result.root!.name).toBe('login.ts')
  })

  it('includes path field for nodes with metadata path or directoryPath', async () => {
    const result = await tree.list({ rootId: 'moduleA', maxDepth: 1 })

    expect(result.root!.path).toBe('/src/auth')
    const funcA1 = result.root!.children!.find(c => c.id === 'funcA1')
    expect(funcA1?.path).toBe('/src/auth/login.ts')
    expect(funcA1?.entityType).toBe('function')
  })
})

describe('fetchNode suggestions and allFeatures', () => {
  let rpg: RepositoryPlanningGraph
  let fetch: FetchNode

  beforeEach(async () => {
    rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })

    await rpg.addLowLevelNode({
      id: 'login.ts',
      feature: { description: 'authentication entry file' },
      metadata: { entityType: 'file', path: '/src/auth/login.ts' },
    })
    await rpg.addLowLevelNode({
      id: 'login.ts:class:LoginController',
      feature: { description: 'orchestrate login flow' },
      metadata: { entityType: 'class', path: '/src/auth/login.ts', startLine: 10, endLine: 50 },
    })
    await rpg.addLowLevelNode({
      id: 'login.ts:function:authenticateUser',
      feature: { description: 'verify user credentials' },
      metadata: { entityType: 'function', path: '/src/auth/login.ts', startLine: 60, endLine: 80 },
    })
    await rpg.addFunctionalEdge({ source: 'login.ts', target: 'login.ts:class:LoginController' })
    await rpg.addFunctionalEdge({ source: 'login.ts', target: 'login.ts:function:authenticateUser' })

    fetch = new FetchNode(rpg)
  })

  it('returns suggestions when ID is mistyped', async () => {
    const result = await fetch.get({ codeEntities: ['logn.ts'] })

    expect(result.entities).toHaveLength(0)
    expect(result.notFound).toEqual(['logn.ts'])
    expect(result.suggestions).toBeDefined()
    expect(result.suggestions).toContain('login.ts')
  })

  it('aggregates all_features for a file-type node', async () => {
    const result = await fetch.get({ codeEntities: ['login.ts'] })

    expect(result.entities).toHaveLength(1)
    expect(result.entities[0]?.allFeatures).toBeDefined()
    expect(result.entities[0]?.allFeatures).toContain('orchestrate login flow')
    expect(result.entities[0]?.allFeatures).toContain('verify user credentials')
  })

  it('does not set allFeatures for non-file nodes', async () => {
    const result = await fetch.get({ codeEntities: ['login.ts:class:LoginController'] })

    expect(result.entities).toHaveLength(1)
    expect(result.entities[0]?.allFeatures).toBeUndefined()
  })

  it('omits suggestions key when none found', async () => {
    const result = await fetch.get({ codeEntities: ['totally-unrelated-xyz-999'] })

    expect(result.notFound).toEqual(['totally-unrelated-xyz-999'])
    expect(result.suggestions).toBeUndefined()
  })
})

describe('exploreRPG suggestions and truncation', () => {
  let rpg: RepositoryPlanningGraph
  let explore: ExploreRPG

  beforeEach(async () => {
    rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })

    await rpg.addHighLevelNode({ id: 'main-module', feature: { description: 'main module' } })

    explore = new ExploreRPG(rpg)
  })

  it('returns notFound + suggestions for unknown start nodes', async () => {
    const result = await explore.traverse({
      startNode: 'man-module', // typo
      edgeType: 'containment',
    })

    expect(result.nodes).toHaveLength(0)
    expect(result.notFound).toBe('man-module')
    expect(result.suggestions).toBeDefined()
    expect(result.suggestions).toContain('main-module')
  })

  it('sets truncated:true when edge cap is exceeded', async () => {
    // Build a hub with many children, exceeding maxEdges
    await rpg.addHighLevelNode({ id: 'hub', feature: { description: 'hub' } })
    for (let i = 0; i < 25; i++) {
      const childId = `child-${i}`
      await rpg.addLowLevelNode({
        id: childId,
        feature: { description: `child ${i}` },
        metadata: { entityType: 'function', path: `/src/${childId}.ts` },
      })
      await rpg.addFunctionalEdge({ source: 'hub', target: childId })
    }

    const result = await explore.traverse({
      startNode: 'hub',
      edgeType: 'containment',
      maxDepth: 1,
    })

    expect(result.edges.length).toBe(20)
    expect(result.truncated).toBe(true)
  })

  it('respects an explicit maxEdges override', async () => {
    await rpg.addHighLevelNode({ id: 'hub', feature: { description: 'hub' } })
    for (let i = 0; i < 10; i++) {
      const childId = `child-${i}`
      await rpg.addLowLevelNode({
        id: childId,
        feature: { description: `child ${i}` },
        metadata: { entityType: 'function', path: `/src/${childId}.ts` },
      })
      await rpg.addFunctionalEdge({ source: 'hub', target: childId })
    }

    const result = await explore.traverse({
      startNode: 'hub',
      edgeType: 'containment',
      maxDepth: 1,
      maxEdges: 3,
    })

    expect(result.edges.length).toBe(3)
    expect(result.truncated).toBe(true)
  })
})

describe('searchNode fuzzy fallback', () => {
  let rpg: RepositoryPlanningGraph
  let search: SearchNode

  beforeEach(async () => {
    rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })

    await rpg.addHighLevelNode({
      id: 'authentication-module',
      feature: { description: 'handle user authentication' },
      directoryPath: '/src/auth',
    })

    search = new SearchNode(rpg)
  })

  it('does not fall back when fuzzyFallback is off', async () => {
    const results = await search.query({
      mode: 'features',
      featureTerms: ['authentcation'], // typo
    })

    // String match misses; fallback disabled by default
    expect(results.totalMatches).toBe(0)
    expect(results.fuzzy).toBeUndefined()
  })

  it('falls back to fuzzy match when no primary results and flag is on', async () => {
    const results = await search.query({
      mode: 'features',
      featureTerms: ['authentcation'], // typo
      fuzzyFallback: true,
    })

    expect(results.totalMatches).toBeGreaterThan(0)
    expect(results.nodes.some(n => n.id === 'authentication-module')).toBe(true)
    expect(results.fuzzy).toBe(true)
  })

  it('does not engage fuzzy when primary already found results', async () => {
    const results = await search.query({
      mode: 'features',
      featureTerms: ['authentication'],
      fuzzyFallback: true,
    })

    expect(results.totalMatches).toBeGreaterThan(0)
    expect(results.fuzzy).toBeUndefined()
  })
})
