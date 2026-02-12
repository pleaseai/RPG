import {
  createDependencyEdge,
  createFunctionalEdge,
  createHighLevelNode,
  createLowLevelNode,
  EdgeType,
  isDependencyEdge,
  isFunctionalEdge,
  isHighLevelNode,
  isLowLevelNode,
  NodeType,
  RepositoryPlanningGraph,
} from '@pleaseai/rpg-graph'
import { describe, expect, it } from 'vitest'

describe('node', () => {
  it('createHighLevelNode creates valid node', () => {
    const node = createHighLevelNode({
      id: 'test-node',
      feature: { description: 'handle authentication' },
      directoryPath: '/src/auth',
    })

    expect(node.id).toBe('test-node')
    expect(node.type).toBe(NodeType.HighLevel)
    expect(node.feature.description).toBe('handle authentication')
    expect(node.directoryPath).toBe('/src/auth')
  })

  it('createLowLevelNode creates valid node', () => {
    const node = createLowLevelNode({
      id: 'func-node',
      feature: {
        description: 'validate user credentials',
        keywords: ['auth', 'login'],
      },
      metadata: {
        entityType: 'function',
        path: '/src/auth/login.ts',
        startLine: 10,
        endLine: 25,
      },
    })

    expect(node.id).toBe('func-node')
    expect(node.type).toBe(NodeType.LowLevel)
    expect(node.metadata.entityType).toBe('function')
    expect(node.metadata.path).toBe('/src/auth/login.ts')
  })

  it('isHighLevelNode returns correct type guard', () => {
    const highLevel = createHighLevelNode({
      id: 'high',
      feature: { description: 'module' },
    })
    const lowLevel = createLowLevelNode({
      id: 'low',
      feature: { description: 'function' },
      metadata: { entityType: 'function', path: '/test.ts' },
    })

    expect(isHighLevelNode(highLevel)).toBe(true)
    expect(isHighLevelNode(lowLevel)).toBe(false)
    expect(isLowLevelNode(highLevel)).toBe(false)
    expect(isLowLevelNode(lowLevel)).toBe(true)
  })
})

describe('edge', () => {
  it('createFunctionalEdge creates valid edge', () => {
    const edge = createFunctionalEdge({
      source: 'parent',
      target: 'child',
      level: 1,
    })

    expect(edge.source).toBe('parent')
    expect(edge.target).toBe('child')
    expect(edge.type).toBe(EdgeType.Functional)
    expect(edge.level).toBe(1)
  })

  it('createDependencyEdge creates valid edge', () => {
    const edge = createDependencyEdge({
      source: 'a',
      target: 'b',
      dependencyType: 'import',
      line: 5,
    })

    expect(edge.source).toBe('a')
    expect(edge.target).toBe('b')
    expect(edge.type).toBe(EdgeType.Dependency)
    expect(edge.dependencyType).toBe('import')
    expect(edge.line).toBe(5)
  })

  it('isFunctionalEdge returns correct type guard', () => {
    const functional = createFunctionalEdge({ source: 'a', target: 'b' })
    const dependency = createDependencyEdge({
      source: 'a',
      target: 'b',
      dependencyType: 'call',
    })

    expect(isFunctionalEdge(functional)).toBe(true)
    expect(isFunctionalEdge(dependency)).toBe(false)
    expect(isDependencyEdge(functional)).toBe(false)
    expect(isDependencyEdge(dependency)).toBe(true)
  })
})

describe('repositoryPlanningGraph', () => {
  it('creates empty graph', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })
    const stats = await rpg.getStats()

    expect(stats.nodeCount).toBe(0)
    expect(stats.edgeCount).toBe(0)
  })

  it('adds and retrieves nodes', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })

    await rpg.addHighLevelNode({
      id: 'module',
      feature: { description: 'auth module' },
    })

    await rpg.addLowLevelNode({
      id: 'func',
      feature: { description: 'login function' },
      metadata: { entityType: 'function', path: '/auth.ts' },
    })

    expect(await rpg.hasNode('module')).toBe(true)
    expect(await rpg.hasNode('func')).toBe(true)
    expect(await rpg.hasNode('nonexistent')).toBe(false)

    const node = await rpg.getNode('module')
    expect(node?.feature.description).toBe('auth module')
  })

  it('adds and retrieves edges', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })

    await rpg.addHighLevelNode({ id: 'parent', feature: { description: 'parent' } })
    await rpg.addLowLevelNode({
      id: 'child',
      feature: { description: 'child' },
      metadata: { entityType: 'file', path: '/test.ts' },
    })

    await rpg.addFunctionalEdge({ source: 'parent', target: 'child' })
    await rpg.addDependencyEdge({
      source: 'child',
      target: 'parent',
      dependencyType: 'import',
    })

    const edges = await rpg.getEdges()
    expect(edges.length).toBe(2)

    const funcEdges = await rpg.getFunctionalEdges()
    expect(funcEdges.length).toBe(1)

    const depEdges = await rpg.getDependencyEdges()
    expect(depEdges.length).toBe(1)
  })

  it('gets children and parent', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })

    await rpg.addHighLevelNode({ id: 'root', feature: { description: 'root' } })
    await rpg.addHighLevelNode({ id: 'child1', feature: { description: 'child1' } })
    await rpg.addHighLevelNode({ id: 'child2', feature: { description: 'child2' } })

    await rpg.addFunctionalEdge({ source: 'root', target: 'child1' })
    await rpg.addFunctionalEdge({ source: 'root', target: 'child2' })

    const children = await rpg.getChildren('root')
    expect(children.length).toBe(2)

    const parent = await rpg.getParent('child1')
    expect(parent?.id).toBe('root')
  })

  it('searches by feature', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })

    await rpg.addHighLevelNode({ id: 'auth', feature: { description: 'handle authentication' } })
    await rpg.addHighLevelNode({ id: 'data', feature: { description: 'process data' } })

    const results = await rpg.searchByFeature('authentication')
    expect(results.length).toBe(1)
    expect(results[0]?.id).toBe('auth')
  })

  it('serializes and deserializes', async () => {
    const rpg = await RepositoryPlanningGraph.create({
      name: 'test-repo',
      description: 'Test repository',
    })

    await rpg.addHighLevelNode({ id: 'root', feature: { description: 'root module' } })
    await rpg.addLowLevelNode({
      id: 'func',
      feature: { description: 'test function' },
      metadata: { entityType: 'function', path: '/test.ts' },
    })
    await rpg.addFunctionalEdge({ source: 'root', target: 'func' })

    const json = await rpg.toJSON()
    const restored = await RepositoryPlanningGraph.fromJSON(json)

    expect((await restored.getStats()).nodeCount).toBe(2)
    expect((await restored.getStats()).edgeCount).toBe(1)
    expect(restored.getConfig().name).toBe('test-repo')
  })
})
