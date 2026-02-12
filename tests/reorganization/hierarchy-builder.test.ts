import type { FileFeatureGroup } from '@pleaseai/rpg-encoder/reorganization'
import { HierarchyBuilder } from '@pleaseai/rpg-encoder/reorganization/hierarchy-builder'
import { RepositoryPlanningGraph } from '@pleaseai/rpg-graph/rpg'
import { describe, expect, it, vi } from 'vitest'

function createMockLLMClient(response: { assignments: Record<string, string[]> }) {
  return {
    complete: vi.fn(),
    completeJSON: vi.fn().mockResolvedValue(response),
    getProvider: vi.fn().mockReturnValue('google'),
    getModel: vi.fn().mockReturnValue('test-model'),
  }
}

const sampleFileGroups: FileFeatureGroup[] = [
  {
    groupLabel: 'auth',
    fileFeatures: [
      {
        fileId: 'auth/login.ts:file',
        filePath: 'auth/login.ts',
        description: 'authenticate user credentials',
        keywords: ['auth', 'login'],
      },
      {
        fileId: 'auth/token.ts:file',
        filePath: 'auth/token.ts',
        description: 'manage JWT tokens',
        keywords: ['auth', 'token'],
      },
    ],
  },
  {
    groupLabel: 'db',
    fileFeatures: [
      {
        fileId: 'db/query.ts:file',
        filePath: 'db/query.ts',
        description: 'execute database queries',
        keywords: ['db', 'query'],
      },
    ],
  },
]

const validAssignments = {
  assignments: {
    'Authentication/credential management/user verification': ['auth'],
    'DataAccess/query execution/database operations': ['db'],
  },
}

describe('hierarchyBuilder', () => {
  it('creates 3-level HighLevelNode hierarchy correctly', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test' })

    // Add file nodes first
    for (const group of sampleFileGroups) {
      for (const file of group.fileFeatures) {
        await rpg.addLowLevelNode({
          id: file.fileId,
          feature: { description: file.description, keywords: file.keywords },
          metadata: { entityType: 'file', path: file.filePath },
        })
      }
    }

    const mockClient = createMockLLMClient(validAssignments)
    const builder = new HierarchyBuilder(rpg, mockClient as any)
    await builder.build(['Authentication', 'DataAccess'], sampleFileGroups)

    // Verify Level 0 (functional areas)
    const authArea = await rpg.getNode('domain:Authentication')
    expect(authArea).toBeDefined()
    expect(authArea!.type).toBe('high_level')
    expect(authArea!.feature.description).toContain('authentication')

    const dataArea = await rpg.getNode('domain:DataAccess')
    expect(dataArea).toBeDefined()

    // Verify Level 1 (categories)
    const credMgmt = await rpg.getNode('domain:Authentication/credential management')
    expect(credMgmt).toBeDefined()
    expect(credMgmt!.feature.description).toBe('credential management')

    // Verify Level 2 (subcategories)
    const userVerif = await rpg.getNode(
      'domain:Authentication/credential management/user verification',
    )
    expect(userVerif).toBeDefined()
    expect(userVerif!.feature.description).toBe('user verification')
  })

  it('creates FunctionalEdges between all hierarchy levels', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test' })

    for (const group of sampleFileGroups) {
      for (const file of group.fileFeatures) {
        await rpg.addLowLevelNode({
          id: file.fileId,
          feature: { description: file.description, keywords: file.keywords },
          metadata: { entityType: 'file', path: file.filePath },
        })
      }
    }

    const mockClient = createMockLLMClient(validAssignments)
    const builder = new HierarchyBuilder(rpg, mockClient as any)
    await builder.build(['Authentication', 'DataAccess'], sampleFileGroups)

    const functionalEdges = await rpg.getFunctionalEdges()

    // Root → Category edges
    const rootToCategory = functionalEdges.filter(
      e =>
        e.source === 'domain:Authentication'
        && e.target === 'domain:Authentication/credential management',
    )
    expect(rootToCategory).toHaveLength(1)

    // Category → Subcategory edges
    const catToSubcat = functionalEdges.filter(
      e =>
        e.source === 'domain:Authentication/credential management'
        && e.target === 'domain:Authentication/credential management/user verification',
    )
    expect(catToSubcat).toHaveLength(1)
  })

  it('links file nodes to correct subcategory nodes', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test' })

    for (const group of sampleFileGroups) {
      for (const file of group.fileFeatures) {
        await rpg.addLowLevelNode({
          id: file.fileId,
          feature: { description: file.description, keywords: file.keywords },
          metadata: { entityType: 'file', path: file.filePath },
        })
      }
    }

    const mockClient = createMockLLMClient(validAssignments)
    const builder = new HierarchyBuilder(rpg, mockClient as any)
    await builder.build(['Authentication', 'DataAccess'], sampleFileGroups)

    const functionalEdges = await rpg.getFunctionalEdges()

    // Auth files should be linked to user verification subcategory
    const authFileEdges = functionalEdges.filter(
      e =>
        e.source === 'domain:Authentication/credential management/user verification'
        && (e.target === 'auth/login.ts:file' || e.target === 'auth/token.ts:file'),
    )
    expect(authFileEdges).toHaveLength(2)

    // DB files should be linked to database operations subcategory
    const dbFileEdges = functionalEdges.filter(
      e =>
        e.source === 'domain:DataAccess/query execution/database operations'
        && e.target === 'db/query.ts:file',
    )
    expect(dbFileEdges).toHaveLength(1)
  })

  it('handles unassigned files with Uncategorized fallback', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test' })

    const groupsWithExtra: FileFeatureGroup[] = [
      ...sampleFileGroups,
      {
        groupLabel: 'misc',
        fileFeatures: [
          {
            fileId: 'misc/utils.ts:file',
            filePath: 'misc/utils.ts',
            description: 'utility functions',
            keywords: ['misc'],
          },
        ],
      },
    ]

    for (const group of groupsWithExtra) {
      for (const file of group.fileFeatures) {
        await rpg.addLowLevelNode({
          id: file.fileId,
          feature: { description: file.description, keywords: file.keywords },
          metadata: { entityType: 'file', path: file.filePath },
        })
      }
    }

    // Only map auth and db, leave misc unassigned
    const mockClient = createMockLLMClient(validAssignments)
    const builder = new HierarchyBuilder(rpg, mockClient as any)
    await builder.build(['Authentication', 'DataAccess'], groupsWithExtra)

    // Check Uncategorized hierarchy was created
    const uncatArea = await rpg.getNode('domain:Uncategorized')
    expect(uncatArea).toBeDefined()

    const uncatCat = await rpg.getNode('domain:Uncategorized/general purpose')
    expect(uncatCat).toBeDefined()

    const uncatSubcat = await rpg.getNode('domain:Uncategorized/general purpose/miscellaneous')
    expect(uncatSubcat).toBeDefined()

    // misc/utils.ts should be linked to miscellaneous subcategory
    const functionalEdges = await rpg.getFunctionalEdges()
    const miscEdge = functionalEdges.filter(
      e =>
        e.source === 'domain:Uncategorized/general purpose/miscellaneous'
        && e.target === 'misc/utils.ts:file',
    )
    expect(miscEdge).toHaveLength(1)
  })

  it('node IDs follow domain:Area/category/subcategory scheme', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test' })

    for (const group of sampleFileGroups) {
      for (const file of group.fileFeatures) {
        await rpg.addLowLevelNode({
          id: file.fileId,
          feature: { description: file.description, keywords: file.keywords },
          metadata: { entityType: 'file', path: file.filePath },
        })
      }
    }

    const mockClient = createMockLLMClient(validAssignments)
    const builder = new HierarchyBuilder(rpg, mockClient as any)
    await builder.build(['Authentication', 'DataAccess'], sampleFileGroups)

    const highLevelNodes = await rpg.getHighLevelNodes()
    const nodeIds = highLevelNodes.map(n => n.id)

    // All should start with domain:
    for (const id of nodeIds) {
      expect(id).toMatch(/^domain:/)
    }

    // Level 0: no slashes after prefix
    expect(nodeIds).toContain('domain:Authentication')
    expect(nodeIds).toContain('domain:DataAccess')

    // Level 1: one slash
    expect(nodeIds).toContain('domain:Authentication/credential management')

    // Level 2: two slashes
    expect(nodeIds).toContain('domain:Authentication/credential management/user verification')
  })

  it('validates that paths must have exactly 3 levels', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test' })

    for (const group of sampleFileGroups) {
      for (const file of group.fileFeatures) {
        await rpg.addLowLevelNode({
          id: file.fileId,
          feature: { description: file.description, keywords: file.keywords },
          metadata: { entityType: 'file', path: file.filePath },
        })
      }
    }

    const invalidAssignments = {
      assignments: {
        'Authentication/credential management': ['auth'],
      },
    }

    const mockClient = createMockLLMClient(invalidAssignments)

    const builder = new HierarchyBuilder(rpg, mockClient as any)
    await expect(builder.build(['Authentication'], sampleFileGroups)).rejects.toThrow(
      'expected exactly 3 levels',
    )
  })

  it('all hierarchy nodes have semantic features', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test' })

    for (const group of sampleFileGroups) {
      for (const file of group.fileFeatures) {
        await rpg.addLowLevelNode({
          id: file.fileId,
          feature: { description: file.description, keywords: file.keywords },
          metadata: { entityType: 'file', path: file.filePath },
        })
      }
    }

    const mockClient = createMockLLMClient(validAssignments)
    const builder = new HierarchyBuilder(rpg, mockClient as any)
    await builder.build(['Authentication', 'DataAccess'], sampleFileGroups)

    const highLevelNodes = await rpg.getHighLevelNodes()
    for (const node of highLevelNodes) {
      expect(node.feature).toBeDefined()
      expect(node.feature.description).toBeTruthy()
      expect(node.feature.keywords).toBeDefined()
      expect(node.feature.keywords!.length).toBeGreaterThan(0)
    }
  })
})
