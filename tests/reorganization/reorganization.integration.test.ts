import type { FileFeatureGroup } from '../../src/encoder/reorganization'
import type { LLMResponse } from '../../src/utils/llm'
import { describe, expect, it, vi } from 'vitest'
import { DomainDiscovery } from '../../src/encoder/reorganization/domain-discovery'
import { HierarchyBuilder } from '../../src/encoder/reorganization/hierarchy-builder'
import { RepositoryPlanningGraph } from '../../src/graph/rpg'

/**
 * Integration test: Full semantic reorganization pipeline
 *
 * Tests Domain Discovery → Hierarchical Construction → Graph verification
 * using mock LLM responses that simulate realistic outputs.
 */
describe('semantic Reorganization Integration', () => {
  // Simulate a realistic repository with multiple directories
  const fileGroups: FileFeatureGroup[] = [
    {
      groupLabel: 'graph',
      fileFeatures: [
        {
          fileId: 'src/graph/rpg.ts:file',
          filePath: 'src/graph/rpg.ts',
          description: 'define repository planning graph data structure',
          keywords: ['graph', 'rpg'],
        },
        {
          fileId: 'src/graph/node.ts:file',
          filePath: 'src/graph/node.ts',
          description: 'define graph node types and schemas',
          keywords: ['graph', 'node'],
        },
        {
          fileId: 'src/graph/edge.ts:file',
          filePath: 'src/graph/edge.ts',
          description: 'define graph edge types',
          keywords: ['graph', 'edge'],
        },
        {
          fileId: 'src/graph/store.ts:file',
          filePath: 'src/graph/store.ts',
          description: 'define graph storage interface',
          keywords: ['graph', 'store'],
        },
      ],
    },
    {
      groupLabel: 'encoder',
      fileFeatures: [
        {
          fileId: 'src/encoder/encoder.ts:file',
          filePath: 'src/encoder/encoder.ts',
          description: 'encode repository into planning graph',
          keywords: ['encoder'],
        },
        {
          fileId: 'src/encoder/semantic.ts:file',
          filePath: 'src/encoder/semantic.ts',
          description: 'extract semantic features from code entities',
          keywords: ['encoder', 'semantic'],
        },
        {
          fileId: 'src/encoder/cache.ts:file',
          filePath: 'src/encoder/cache.ts',
          description: 'cache semantic extraction results',
          keywords: ['encoder', 'cache'],
        },
      ],
    },
    {
      groupLabel: 'utils',
      fileFeatures: [
        {
          fileId: 'src/utils/ast.ts:file',
          filePath: 'src/utils/ast.ts',
          description: 'parse source code using tree-sitter AST',
          keywords: ['utils', 'ast'],
        },
        {
          fileId: 'src/utils/llm.ts:file',
          filePath: 'src/utils/llm.ts',
          description: 'provide LLM client interface',
          keywords: ['utils', 'llm'],
        },
      ],
    },
  ]

  function createMockLLMClient() {
    const domainResponse = `<solution>
["GraphInfrastructure", "SemanticEncoding", "CoreUtilities"]
</solution>`

    const hierarchyResponse = `<solution>
{
  "GraphInfrastructure/data modeling/graph representation": ["graph"],
  "SemanticEncoding/code analysis/feature extraction": ["encoder"],
  "CoreUtilities/tool integration/parsing support": ["utils"]
}
</solution>`

    let callCount = 0
    return {
      complete: vi.fn().mockImplementation(() => {
        callCount++
        const content = callCount === 1 ? domainResponse : hierarchyResponse
        return Promise.resolve({
          content,
          usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
          model: 'test-model',
        } satisfies LLMResponse)
      }),
      completeJSON: vi.fn(),
      getProvider: vi.fn().mockReturnValue('google'),
      getModel: vi.fn().mockReturnValue('test-model'),
    }
  }

  it('full pipeline: domain discovery → hierarchy construction → graph verification', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })

    // Add all file nodes to RPG (simulating Phase 1 output)
    for (const group of fileGroups) {
      for (const file of group.fileFeatures) {
        await rpg.addLowLevelNode({
          id: file.fileId,
          feature: { description: file.description, keywords: file.keywords },
          metadata: { entityType: 'file', path: file.filePath },
        })
      }
    }

    const mockClient = createMockLLMClient()

    // Step 1: Domain Discovery
    const discovery = new DomainDiscovery(mockClient as any)
    const { functionalAreas } = await discovery.discover(fileGroups)

    expect(functionalAreas).toEqual(['GraphInfrastructure', 'SemanticEncoding', 'CoreUtilities'])

    // Step 2: Hierarchical Construction
    const builder = new HierarchyBuilder(rpg, mockClient as any)
    await builder.build(functionalAreas, fileGroups)

    // Verify: HighLevelNodes are NOT directory mirrors
    const highLevelNodes = await rpg.getHighLevelNodes()
    const hlNodeIds = highLevelNodes.map(n => n.id)

    // No dir: prefixed nodes
    for (const id of hlNodeIds) {
      expect(id).not.toMatch(/^dir:/)
      expect(id).toMatch(/^domain:/)
    }

    // Verify: 3-level path structure in node IDs
    // Level 0: domain:Area
    expect(hlNodeIds).toContain('domain:GraphInfrastructure')
    expect(hlNodeIds).toContain('domain:SemanticEncoding')
    expect(hlNodeIds).toContain('domain:CoreUtilities')

    // Level 1: domain:Area/category
    expect(hlNodeIds).toContain('domain:GraphInfrastructure/data modeling')
    expect(hlNodeIds).toContain('domain:SemanticEncoding/code analysis')
    expect(hlNodeIds).toContain('domain:CoreUtilities/tool integration')

    // Level 2: domain:Area/category/subcategory
    expect(hlNodeIds).toContain('domain:GraphInfrastructure/data modeling/graph representation')
    expect(hlNodeIds).toContain('domain:SemanticEncoding/code analysis/feature extraction')
    expect(hlNodeIds).toContain('domain:CoreUtilities/tool integration/parsing support')

    // Verify: 3 levels × 3 areas = 9 high-level nodes
    expect(highLevelNodes).toHaveLength(9)
  })

  it('all file nodes are reachable via functional edges from roots', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })

    for (const group of fileGroups) {
      for (const file of group.fileFeatures) {
        await rpg.addLowLevelNode({
          id: file.fileId,
          feature: { description: file.description, keywords: file.keywords },
          metadata: { entityType: 'file', path: file.filePath },
        })
      }
    }

    const mockClient = createMockLLMClient()
    const discovery = new DomainDiscovery(mockClient as any)
    const { functionalAreas } = await discovery.discover(fileGroups)
    const builder = new HierarchyBuilder(rpg, mockClient as any)
    await builder.build(functionalAreas, fileGroups)

    // BFS from all roots to collect reachable nodes
    const roots = ['domain:GraphInfrastructure', 'domain:SemanticEncoding', 'domain:CoreUtilities']
    const reachable = new Set<string>()
    const queue = [...roots]

    while (queue.length > 0) {
      const current = queue.shift()!
      if (reachable.has(current))
        continue
      reachable.add(current)

      const children = await rpg.getChildren(current)
      for (const child of children) {
        if (!reachable.has(child.id)) {
          queue.push(child.id)
        }
      }
    }

    // All file nodes should be reachable
    const allFileIds = fileGroups.flatMap(g => g.fileFeatures.map(f => f.fileId))
    for (const fileId of allFileIds) {
      expect(reachable.has(fileId)).toBe(true)
    }
  })

  it('same LowLevelNodes exist before and after reorganization', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })

    for (const group of fileGroups) {
      for (const file of group.fileFeatures) {
        await rpg.addLowLevelNode({
          id: file.fileId,
          feature: { description: file.description, keywords: file.keywords },
          metadata: { entityType: 'file', path: file.filePath },
        })
      }
    }

    const lowLevelBefore = (await rpg.getLowLevelNodes()).map(n => n.id).sort()

    const mockClient = createMockLLMClient()
    const discovery = new DomainDiscovery(mockClient as any)
    const { functionalAreas } = await discovery.discover(fileGroups)
    const builder = new HierarchyBuilder(rpg, mockClient as any)
    await builder.build(functionalAreas, fileGroups)

    const lowLevelAfter = (await rpg.getLowLevelNodes()).map(n => n.id).sort()

    // LowLevelNodes should be identical — reorganization only adds HighLevelNodes
    expect(lowLevelAfter).toEqual(lowLevelBefore)
  })

  it('hierarchy has correct edge structure', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })

    for (const group of fileGroups) {
      for (const file of group.fileFeatures) {
        await rpg.addLowLevelNode({
          id: file.fileId,
          feature: { description: file.description, keywords: file.keywords },
          metadata: { entityType: 'file', path: file.filePath },
        })
      }
    }

    const mockClient = createMockLLMClient()
    const discovery = new DomainDiscovery(mockClient as any)
    const { functionalAreas } = await discovery.discover(fileGroups)
    const builder = new HierarchyBuilder(rpg, mockClient as any)
    await builder.build(functionalAreas, fileGroups)

    const functionalEdges = await rpg.getFunctionalEdges()

    // Count edge types
    const rootToCategory = functionalEdges.filter(
      e => e.source.match(/^domain:[^/]+$/) && e.target.match(/^domain:[^/]+\/[^/]+$/),
    )
    const categoryToSubcategory = functionalEdges.filter(
      e =>
        e.source.match(/^domain:[^/]+\/[^/]+$/) && e.target.match(/^domain:[^/]+\/[^/]+\/[^/]+$/),
    )
    const subcategoryToFile = functionalEdges.filter(
      e => e.source.match(/^domain:[^/]+\/[^/]+\/[^/]+$/) && !e.target.startsWith('domain:'),
    )

    // 3 root→category edges (one per area)
    expect(rootToCategory).toHaveLength(3)

    // 3 category→subcategory edges
    expect(categoryToSubcategory).toHaveLength(3)

    // 9 subcategory→file edges (4 graph + 3 encoder + 2 utils)
    expect(subcategoryToFile).toHaveLength(9)
  })
})
