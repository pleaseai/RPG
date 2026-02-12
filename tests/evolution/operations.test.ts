import type { OperationContext } from '@pleaseai/rpg-encoder/evolution/operations'
import type { ChangedEntity } from '@pleaseai/rpg-encoder/evolution/types'
import {
  deleteNode,
  findMatchingNode,
  insertNode,
  processModification,
} from '@pleaseai/rpg-encoder/evolution/operations'
import { SemanticRouter } from '@pleaseai/rpg-encoder/evolution/semantic-router'
import { SemanticExtractor } from '@pleaseai/rpg-encoder/semantic'
import { RepositoryPlanningGraph } from '@pleaseai/rpg-graph/rpg'
import { beforeEach, describe, expect, it } from 'vitest'

describe('deleteNode (AC-2)', () => {
  let rpg: RepositoryPlanningGraph

  beforeEach(async () => {
    rpg = await RepositoryPlanningGraph.create({ name: 'test' })

    // Build a small hierarchy:
    // dir:src (HL) → src/utils.ts:file (LL) → src/utils.ts:function:helper (LL)
    await rpg.addHighLevelNode({
      id: 'dir:src',
      feature: { description: 'source directory' },
      directoryPath: 'src',
    })
    await rpg.addLowLevelNode({
      id: 'src/utils.ts:file:src/utils.ts',
      feature: { description: 'utility functions' },
      metadata: { entityType: 'file', path: 'src/utils.ts' },
    })
    await rpg.addLowLevelNode({
      id: 'src/utils.ts:function:helper',
      feature: { description: 'helper function' },
      metadata: { entityType: 'function', path: 'src/utils.ts' },
    })
    await rpg.addLowLevelNode({
      id: 'src/utils.ts:function:format',
      feature: { description: 'format data' },
      metadata: { entityType: 'function', path: 'src/utils.ts' },
    })

    // Functional edges
    await rpg.addFunctionalEdge({ source: 'dir:src', target: 'src/utils.ts:file:src/utils.ts' })
    await rpg.addFunctionalEdge({
      source: 'src/utils.ts:file:src/utils.ts',
      target: 'src/utils.ts:function:helper',
    })
    await rpg.addFunctionalEdge({
      source: 'src/utils.ts:file:src/utils.ts',
      target: 'src/utils.ts:function:format',
    })

    // Dependency edge
    await rpg.addLowLevelNode({
      id: 'src/main.ts:file:src/main.ts',
      feature: { description: 'main entry' },
      metadata: { entityType: 'file', path: 'src/main.ts' },
    })
    await rpg.addFunctionalEdge({ source: 'dir:src', target: 'src/main.ts:file:src/main.ts' })
    await rpg.addDependencyEdge({
      source: 'src/main.ts:file:src/main.ts',
      target: 'src/utils.ts:file:src/utils.ts',
      dependencyType: 'import',
    })
  })

  it('removes a node from the graph', async () => {
    await deleteNode(rpg, 'src/utils.ts:function:helper')

    expect(await rpg.hasNode('src/utils.ts:function:helper')).toBe(false)
  })

  it('cascade removes functional edges', async () => {
    await deleteNode(rpg, 'src/utils.ts:function:helper')

    // The functional edge from file to helper should be gone
    const edges = await rpg.getFunctionalEdges()
    const helperEdges = edges.filter(
      e =>
        e.source === 'src/utils.ts:file:src/utils.ts' && e.target === 'src/utils.ts:function:helper',
    )
    expect(helperEdges).toHaveLength(0)
  })

  it('cascade removes dependency edges', async () => {
    await deleteNode(rpg, 'src/utils.ts:file:src/utils.ts')

    // The dependency edge from main to utils should be gone
    const depEdges = await rpg.getDependencyEdges()
    const utilsEdges = depEdges.filter(e => e.target === 'src/utils.ts:file:src/utils.ts')
    expect(utilsEdges).toHaveLength(0)
  })

  it('prunes empty ancestor HighLevelNodes', async () => {
    // Remove all children of dir:src
    await deleteNode(rpg, 'src/utils.ts:function:helper')
    await deleteNode(rpg, 'src/utils.ts:function:format')
    await deleteNode(rpg, 'src/utils.ts:file:src/utils.ts')
    await deleteNode(rpg, 'src/main.ts:file:src/main.ts')

    // dir:src should now be pruned (no children)
    expect(await rpg.hasNode('dir:src')).toBe(false)
  })

  it('stops pruning at first non-empty ancestor', async () => {
    // Remove only the helper function
    await deleteNode(rpg, 'src/utils.ts:function:helper')

    // dir:src still has children (the file node), so it stays
    expect(await rpg.hasNode('dir:src')).toBe(true)
    expect(await rpg.hasNode('src/utils.ts:file:src/utils.ts')).toBe(true)
  })

  it('is idempotent — deleting non-existent node returns 0', async () => {
    const pruned = await deleteNode(rpg, 'non-existent-node')
    expect(pruned).toBe(0)
  })
})

describe('insertNode (AC-4)', () => {
  let rpg: RepositoryPlanningGraph
  let ctx: OperationContext

  beforeEach(async () => {
    rpg = await RepositoryPlanningGraph.create({ name: 'test' })

    // Create a directory hierarchy
    await rpg.addHighLevelNode({
      id: 'dir:packages/utils',
      feature: { description: 'utils package directory' },
      directoryPath: 'packages/utils',
    })
    await rpg.addHighLevelNode({
      id: 'dir:packages/utils/src',
      feature: { description: 'utility functions' },
      directoryPath: 'packages/utils/src',
    })
    await rpg.addFunctionalEdge({ source: 'dir:packages/utils', target: 'dir:packages/utils/src' })

    const semanticExtractor = new SemanticExtractor({ useLLM: false })
    const semanticRouter = new SemanticRouter(rpg)

    ctx = {
      semanticExtractor,
      semanticRouter,
      repoPath: '/tmp/test',
    }
  })

  it('creates a new LowLevelNode in the graph', async () => {
    const entity: ChangedEntity = {
      id: 'packages/utils/src/helper.ts:function:processData',
      filePath: 'packages/utils/src/helper.ts',
      entityType: 'function',
      entityName: 'processData',
      qualifiedName: 'processData',
      sourceCode: 'function processData() { return 42 }',
    }

    await insertNode(rpg, entity, ctx)

    expect(await rpg.hasNode(entity.id)).toBe(true)
    const node = await rpg.getNode(entity.id)
    expect(node?.feature.description).toBeDefined()
  })

  it('creates functional edge from parent to new node', async () => {
    const entity: ChangedEntity = {
      id: 'packages/utils/src/helper.ts:function:doStuff',
      filePath: 'packages/utils/src/helper.ts',
      entityType: 'function',
      entityName: 'doStuff',
      qualifiedName: 'doStuff',
    }

    await insertNode(rpg, entity, ctx)

    // Should have a functional edge pointing to the new node
    const edges = await rpg.getFunctionalEdges()
    const newNodeEdges = edges.filter(e => e.target === entity.id)
    expect(newNodeEdges.length).toBeGreaterThanOrEqual(1)
  })
})

describe('processModification (AC-3)', () => {
  let rpg: RepositoryPlanningGraph
  let ctx: OperationContext

  beforeEach(async () => {
    rpg = await RepositoryPlanningGraph.create({ name: 'test' })

    await rpg.addHighLevelNode({
      id: 'dir:src',
      feature: { description: 'source directory' },
      directoryPath: 'src',
    })

    // Add an existing node
    await rpg.addLowLevelNode({
      id: 'src/math.ts:function:add',
      feature: { description: 'add two numbers', keywords: ['add', 'math', 'numbers'] },
      metadata: { entityType: 'function', path: 'src/math.ts' },
    })
    await rpg.addFunctionalEdge({ source: 'dir:src', target: 'src/math.ts:function:add' })

    const semanticExtractor = new SemanticExtractor({ useLLM: false })
    const semanticRouter = new SemanticRouter(rpg)

    ctx = {
      semanticExtractor,
      semanticRouter,
      repoPath: '/tmp/test',
    }
  })

  it('in-place updates when drift is low', async () => {
    const oldEntity: ChangedEntity = {
      id: 'src/math.ts:function:add',
      filePath: 'src/math.ts',
      entityType: 'function',
      entityName: 'add',
      qualifiedName: 'add',
      sourceCode: 'function add(a, b) { return a + b }',
    }

    const newEntity: ChangedEntity = {
      id: 'src/math.ts:function:add',
      filePath: 'src/math.ts',
      entityType: 'function',
      entityName: 'add',
      qualifiedName: 'add',
      sourceCode: 'function add(a: number, b: number): number { return a + b }',
    }

    // Use a very high drift threshold so it stays in-place
    const result = await processModification(rpg, oldEntity, newEntity, ctx, 0.99)

    expect(result.rerouted).toBe(false)
    expect(await rpg.hasNode('src/math.ts:function:add')).toBe(true)
  })

  it('re-routes when drift is high', async () => {
    const oldEntity: ChangedEntity = {
      id: 'src/math.ts:function:add',
      filePath: 'src/math.ts',
      entityType: 'function',
      entityName: 'add',
      qualifiedName: 'add',
      sourceCode: 'function add(a, b) { return a + b }',
    }

    const newEntity: ChangedEntity = {
      id: 'src/math.ts:function:add',
      filePath: 'src/math.ts',
      entityType: 'function',
      entityName: 'add',
      qualifiedName: 'add',
      sourceCode: 'function add(item) { database.insert(item) }',
    }

    // Use a very low drift threshold to force re-routing
    const result = await processModification(rpg, oldEntity, newEntity, ctx, 0.01)

    expect(result.rerouted).toBe(true)
    // The node should still exist (was deleted then re-inserted with same ID)
    expect(await rpg.hasNode('src/math.ts:function:add')).toBe(true)
  })

  it('treats missing node as insertion', async () => {
    const oldEntity: ChangedEntity = {
      id: 'src/math.ts:function:nonExistent',
      filePath: 'src/math.ts',
      entityType: 'function',
      entityName: 'nonExistent',
      qualifiedName: 'nonExistent',
    }

    const newEntity: ChangedEntity = {
      id: 'src/math.ts:function:nonExistent',
      filePath: 'src/math.ts',
      entityType: 'function',
      entityName: 'nonExistent',
      qualifiedName: 'nonExistent',
      sourceCode: 'function nonExistent() {}',
    }

    const result = await processModification(rpg, oldEntity, newEntity, ctx)
    expect(result.rerouted).toBe(false)
    expect(await rpg.hasNode('src/math.ts:function:nonExistent')).toBe(true)
  })
})

describe('findMatchingNode', () => {
  it('finds node by exact ID match', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test' })
    await rpg.addLowLevelNode({
      id: 'src/a.ts:function:foo',
      feature: { description: 'foo' },
      metadata: { entityType: 'function', path: 'src/a.ts' },
    })

    const entity: ChangedEntity = {
      id: 'src/a.ts:function:foo',
      filePath: 'src/a.ts',
      entityType: 'function',
      entityName: 'foo',
      qualifiedName: 'foo',
    }

    const result = await findMatchingNode(rpg, entity)
    expect(result).toBe('src/a.ts:function:foo')
  })

  it('falls back to prefix match for line-number-based IDs', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test' })
    // Encoder-style ID with line number
    await rpg.addLowLevelNode({
      id: 'src/a.ts:function:foo:10',
      feature: { description: 'foo' },
      metadata: { entityType: 'function', path: 'src/a.ts' },
    })

    const entity: ChangedEntity = {
      id: 'src/a.ts:function:foo',
      filePath: 'src/a.ts',
      entityType: 'function',
      entityName: 'foo',
      qualifiedName: 'foo',
    }

    const result = await findMatchingNode(rpg, entity)
    expect(result).toBe('src/a.ts:function:foo:10')
  })

  it('returns null when no match found', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test' })

    const entity: ChangedEntity = {
      id: 'src/a.ts:function:bar',
      filePath: 'src/a.ts',
      entityType: 'function',
      entityName: 'bar',
      qualifiedName: 'bar',
    }

    const result = await findMatchingNode(rpg, entity)
    expect(result).toBeNull()
  })
})
