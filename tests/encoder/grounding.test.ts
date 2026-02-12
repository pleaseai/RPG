import { ArtifactGrounder, computeLCA } from '@pleaseai/rpg-encoder/grounding'
import { RepositoryPlanningGraph } from '@pleaseai/rpg-graph'
import { describe, expect, it } from 'vitest'

describe('computeLCA (PathTrie)', () => {
  it('should return empty array for empty input', () => {
    const result = computeLCA(new Set())
    expect(result).toEqual([])
  })

  it('should return single path when all inputs share one directory', () => {
    const result = computeLCA(new Set(['packages/graph/src']))
    expect(result).toEqual(['packages/graph/src'])
  })

  it('should return single path for multiple files in same directory', () => {
    // All files are under packages/graph/src/* — LCA is packages/graph/src
    const result = computeLCA(
      new Set(['packages/graph/src/fileA.ts', 'packages/graph/src/fileB.ts']),
    )
    expect(result).toEqual(['packages/graph/src'])
  })

  it('should return branching node when paths diverge', () => {
    // packages/graph/src and packages/encoder/src diverge at packages/
    const result = computeLCA(new Set(['packages/graph/src', 'packages/encoder/src']))
    expect(result).toHaveLength(1)
    expect(result).toContain('packages')
  })

  it('should return multiple LCA paths for unrelated directories', () => {
    // packages/graph/src and tests/encoder share no common prefix beyond root
    const result = computeLCA(new Set(['packages/graph/src', 'tests/encoder']))
    expect(result).toHaveLength(2)
    expect(result.sort()).toEqual(['packages/graph/src', 'tests/encoder'])
  })

  it('should handle deeply nested paths with branching', () => {
    // packages/encoder/src/reorganization and packages/encoder/src/evolution diverge at packages/encoder/src
    const result = computeLCA(
      new Set(['packages/encoder/src/reorganization', 'packages/encoder/src/evolution']),
    )
    expect(result).toHaveLength(1)
    expect(result).toContain('packages/encoder/src')
  })

  it('should handle mix of related and unrelated paths', () => {
    const result = computeLCA(
      new Set(['packages/graph/src', 'packages/encoder/src', 'tests/fixtures']),
    )
    // packages/graph/src and packages/encoder/src merge to packages, tests/fixtures stays separate
    expect(result).toHaveLength(2)
    expect(result.sort()).toEqual(['packages', 'tests/fixtures'])
  })

  it('should handle root-level paths', () => {
    const result = computeLCA(new Set(['.']))
    expect(result).toEqual(['.'])
  })

  it('should handle paths with common prefix but different depths', () => {
    // packages/encoder/src and packages/encoder/src/reorganization
    // packages/encoder/src is terminal, packages/encoder/src/reorganization is deeper
    const result = computeLCA(
      new Set(['packages/encoder/src', 'packages/encoder/src/reorganization']),
    )
    // packages/encoder/src is both terminal and has a child — it's a branching/terminal point
    expect(result).toHaveLength(1)
    expect(result).toContain('packages/encoder/src')
  })

  it('should correctly prune subtrees to prevent redundant paths', () => {
    // All paths under packages/encoder/src/* should consolidate to packages/encoder/src
    const result = computeLCA(
      new Set([
        'packages/encoder/src/reorganization',
        'packages/encoder/src/evolution',
        'packages/encoder/src/semantic',
      ]),
    )
    expect(result).toHaveLength(1)
    expect(result).toContain('packages/encoder/src')
  })

  it('should handle three-way branching', () => {
    // a/b, a/c, a/d all diverge at a
    const result = computeLCA(new Set(['a/b', 'a/c', 'a/d']))
    expect(result).toHaveLength(1)
    expect(result).toContain('a')
  })

  it('should distinguish similar-prefix segment names', () => {
    // packages/graph and packages/graph-store are different segments under packages
    const result = computeLCA(new Set(['packages/graph', 'packages/graph-store']))
    expect(result).toHaveLength(1)
    expect(result).toContain('packages')
  })
})

describe('ArtifactGrounder', () => {
  async function createTestRPG() {
    return RepositoryPlanningGraph.create({ name: 'test' })
  }

  it('should populate metadata.path for HighLevelNodes with single directory', async () => {
    const rpg = await createTestRPG()

    // Create hierarchy: HL -> LL(file in packages/graph/src)
    await rpg.addHighLevelNode({
      id: 'domain:GraphStorage',
      feature: { description: 'manage graph storage' },
    })
    await rpg.addLowLevelNode({
      id: 'packages/graph/src/node.ts:file',
      feature: { description: 'define graph nodes' },
      metadata: { entityType: 'file', path: 'packages/graph/src/node.ts' },
    })
    await rpg.addLowLevelNode({
      id: 'packages/graph/src/edge.ts:file',
      feature: { description: 'define graph edges' },
      metadata: { entityType: 'file', path: 'packages/graph/src/edge.ts' },
    })
    await rpg.addFunctionalEdge({ source: 'domain:GraphStorage', target: 'packages/graph/src/node.ts:file' })
    await rpg.addFunctionalEdge({ source: 'domain:GraphStorage', target: 'packages/graph/src/edge.ts:file' })

    const grounder = new ArtifactGrounder(rpg)
    await grounder.ground()

    const node = await rpg.getNode('domain:GraphStorage')
    expect(node?.metadata?.path).toBe('packages/graph/src')
    expect(node?.metadata?.entityType).toBe('module')
  })

  it('should set metadata.extra.paths for multi-directory HighLevelNodes', async () => {
    const rpg = await createTestRPG()

    await rpg.addHighLevelNode({
      id: 'domain:Testing',
      feature: { description: 'testing infrastructure' },
    })
    await rpg.addLowLevelNode({
      id: 'packages/utils/src/test-helper.ts:file',
      feature: { description: 'test helpers' },
      metadata: { entityType: 'file', path: 'packages/utils/src/test-helper.ts' },
    })
    await rpg.addLowLevelNode({
      id: 'tests/graph/graph.test.ts:file',
      feature: { description: 'graph tests' },
      metadata: { entityType: 'file', path: 'tests/graph/graph.test.ts' },
    })
    await rpg.addFunctionalEdge({ source: 'domain:Testing', target: 'packages/utils/src/test-helper.ts:file' })
    await rpg.addFunctionalEdge({ source: 'domain:Testing', target: 'tests/graph/graph.test.ts:file' })

    const grounder = new ArtifactGrounder(rpg)
    await grounder.ground()

    const node = await rpg.getNode('domain:Testing')
    expect(node?.metadata?.entityType).toBe('module')
    expect(node?.metadata?.path).toBeDefined()
    expect(node?.metadata?.extra?.paths).toBeDefined()
    const paths = node?.metadata?.extra?.paths as string[]
    expect(paths).toHaveLength(2)
    expect(paths).toContain('packages/utils/src')
    expect(paths).toContain('tests/graph')
  })

  it('should handle HighLevelNodes with no leaf descendants', async () => {
    const rpg = await createTestRPG()

    await rpg.addHighLevelNode({
      id: 'domain:Empty',
      feature: { description: 'empty domain' },
    })

    const grounder = new ArtifactGrounder(rpg)
    await grounder.ground()

    const node = await rpg.getNode('domain:Empty')
    // No metadata should be set since there are no leaf descendants
    expect(node?.metadata?.path).toBeUndefined()
  })

  it('should propagate through nested HighLevelNodes', async () => {
    const rpg = await createTestRPG()

    // 3-level hierarchy: area -> category -> subcategory -> files
    await rpg.addHighLevelNode({
      id: 'domain:Core',
      feature: { description: 'core functionality' },
    })
    await rpg.addHighLevelNode({
      id: 'domain:Core/storage',
      feature: { description: 'storage' },
    })
    await rpg.addHighLevelNode({
      id: 'domain:Core/storage/graph',
      feature: { description: 'graph storage' },
    })
    await rpg.addLowLevelNode({
      id: 'packages/graph/src/store.ts:file',
      feature: { description: 'graph store' },
      metadata: { entityType: 'file', path: 'packages/graph/src/store.ts' },
    })

    await rpg.addFunctionalEdge({ source: 'domain:Core', target: 'domain:Core/storage' })
    await rpg.addFunctionalEdge({ source: 'domain:Core/storage', target: 'domain:Core/storage/graph' })
    await rpg.addFunctionalEdge({ source: 'domain:Core/storage/graph', target: 'packages/graph/src/store.ts:file' })

    const grounder = new ArtifactGrounder(rpg)
    await grounder.ground()

    // All HighLevelNodes should get packages/graph/src as their path
    const leaf = await rpg.getNode('domain:Core/storage/graph')
    expect(leaf?.metadata?.path).toBe('packages/graph/src')

    const mid = await rpg.getNode('domain:Core/storage')
    expect(mid?.metadata?.path).toBe('packages/graph/src')

    const root = await rpg.getNode('domain:Core')
    expect(root?.metadata?.path).toBe('packages/graph/src')
  })

  it('should handle entityType set to module for grounded nodes', async () => {
    const rpg = await createTestRPG()

    await rpg.addHighLevelNode({
      id: 'domain:Encoder',
      feature: { description: 'encoding pipeline' },
    })
    await rpg.addLowLevelNode({
      id: 'packages/encoder/src/encoder.ts:file',
      feature: { description: 'encoder' },
      metadata: { entityType: 'file', path: 'packages/encoder/src/encoder.ts' },
    })
    await rpg.addFunctionalEdge({ source: 'domain:Encoder', target: 'packages/encoder/src/encoder.ts:file' })

    const grounder = new ArtifactGrounder(rpg)
    await grounder.ground()

    const node = await rpg.getNode('domain:Encoder')
    expect(node?.metadata?.entityType).toBe('module')
  })

  it('should make HighLevelNodes findable via searchByPath using primary path', async () => {
    const rpg = await createTestRPG()

    await rpg.addHighLevelNode({
      id: 'domain:Graph',
      feature: { description: 'graph module' },
    })
    await rpg.addLowLevelNode({
      id: 'packages/graph/src/node.ts:file',
      feature: { description: 'graph nodes' },
      metadata: { entityType: 'file', path: 'packages/graph/src/node.ts' },
    })
    await rpg.addFunctionalEdge({ source: 'domain:Graph', target: 'packages/graph/src/node.ts:file' })

    const grounder = new ArtifactGrounder(rpg)
    await grounder.ground()

    // searchByPath should now find the grounded HighLevelNode
    const results = await rpg.searchByPath('packages/graph/src*')
    const ids = results.map(n => n.id)
    expect(ids).toContain('domain:Graph')
    expect(ids).toContain('packages/graph/src/node.ts:file')
  })

  it('should not set extra.paths for single-LCA nodes', async () => {
    const rpg = await createTestRPG()

    await rpg.addHighLevelNode({
      id: 'domain:SingleDir',
      feature: { description: 'single directory module' },
    })
    await rpg.addLowLevelNode({
      id: 'packages/graph/src/a.ts:file',
      feature: { description: 'file a' },
      metadata: { entityType: 'file', path: 'packages/graph/src/a.ts' },
    })
    await rpg.addLowLevelNode({
      id: 'packages/graph/src/b.ts:file',
      feature: { description: 'file b' },
      metadata: { entityType: 'file', path: 'packages/graph/src/b.ts' },
    })
    await rpg.addFunctionalEdge({ source: 'domain:SingleDir', target: 'packages/graph/src/a.ts:file' })
    await rpg.addFunctionalEdge({ source: 'domain:SingleDir', target: 'packages/graph/src/b.ts:file' })

    const grounder = new ArtifactGrounder(rpg)
    await grounder.ground()

    const node = await rpg.getNode('domain:SingleDir')
    expect(node?.metadata?.path).toBe('packages/graph/src')
    expect(node?.metadata?.extra?.paths).toBeUndefined()
  })

  it('should preserve pre-existing metadata.extra fields during grounding', async () => {
    const rpg = await createTestRPG()

    await rpg.addHighLevelNode({
      id: 'domain:WithExtra',
      feature: { description: 'node with existing extra' },
      metadata: { entityType: 'module', extra: { customField: 'preserved-value' } },
    })
    await rpg.addLowLevelNode({
      id: 'src/a/x.ts:file',
      feature: { description: 'file x' },
      metadata: { entityType: 'file', path: 'src/a/x.ts' },
    })
    await rpg.addLowLevelNode({
      id: 'tests/b/y.ts:file',
      feature: { description: 'file y' },
      metadata: { entityType: 'file', path: 'tests/b/y.ts' },
    })
    await rpg.addFunctionalEdge({ source: 'domain:WithExtra', target: 'src/a/x.ts:file' })
    await rpg.addFunctionalEdge({ source: 'domain:WithExtra', target: 'tests/b/y.ts:file' })

    const grounder = new ArtifactGrounder(rpg)
    await grounder.ground()

    const node = await rpg.getNode('domain:WithExtra')
    expect(node?.metadata?.extra?.paths).toBeDefined()
    expect(node?.metadata?.extra?.customField).toBe('preserved-value')
  })

  it('should skip LowLevelNodes with missing metadata.path gracefully', async () => {
    const rpg = await createTestRPG()

    await rpg.addHighLevelNode({
      id: 'domain:PartialPaths',
      feature: { description: 'partial path data' },
    })
    await rpg.addLowLevelNode({
      id: 'packages/graph/src/node.ts:file',
      feature: { description: 'graph nodes' },
      metadata: { entityType: 'file', path: 'packages/graph/src/node.ts' },
    })
    await rpg.addLowLevelNode({
      id: 'missing-path:file',
      feature: { description: 'no path node' },
      metadata: { entityType: 'file' },
    })
    await rpg.addFunctionalEdge({ source: 'domain:PartialPaths', target: 'packages/graph/src/node.ts:file' })
    await rpg.addFunctionalEdge({ source: 'domain:PartialPaths', target: 'missing-path:file' })

    const grounder = new ArtifactGrounder(rpg)
    await grounder.ground()

    // Should use only the node with a path
    const node = await rpg.getNode('domain:PartialPaths')
    expect(node?.metadata?.path).toBe('packages/graph/src')
    expect(node?.metadata?.entityType).toBe('module')
  })

  it('should make HighLevelNodes findable via searchByPath using extra.paths', async () => {
    const rpg = await createTestRPG()

    await rpg.addHighLevelNode({
      id: 'domain:CrossCutting',
      feature: { description: 'cross-cutting concern' },
    })
    await rpg.addLowLevelNode({
      id: 'packages/utils/src/helper.ts:file',
      feature: { description: 'utility helpers' },
      metadata: { entityType: 'file', path: 'packages/utils/src/helper.ts' },
    })
    await rpg.addLowLevelNode({
      id: 'tests/utils/helper.test.ts:file',
      feature: { description: 'helper tests' },
      metadata: { entityType: 'file', path: 'tests/utils/helper.test.ts' },
    })
    await rpg.addFunctionalEdge({ source: 'domain:CrossCutting', target: 'packages/utils/src/helper.ts:file' })
    await rpg.addFunctionalEdge({ source: 'domain:CrossCutting', target: 'tests/utils/helper.test.ts:file' })

    const grounder = new ArtifactGrounder(rpg)
    await grounder.ground()

    // Primary path is the first alphabetically (packages/utils/src or tests/utils)
    // searchByPath for tests/utils should find the node via extra.paths
    const results = await rpg.searchByPath('tests/utils*')
    const ids = results.map(n => n.id)
    expect(ids).toContain('domain:CrossCutting')
    expect(ids).toContain('tests/utils/helper.test.ts:file')
  })
})
