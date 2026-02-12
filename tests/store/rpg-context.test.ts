import type { HighLevelNode, Node } from '@pleaseai/rpg-graph'
import { RepositoryPlanningGraph } from '@pleaseai/rpg-graph/rpg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('RPG with ContextStore (default)', () => {
  let rpg: RepositoryPlanningGraph

  beforeEach(async () => {
    rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })
  })

  afterEach(async () => {
    await rpg.close()
  })

  it('add and get high-level node', async () => {
    await rpg.addHighLevelNode({
      id: 'auth',
      feature: { description: 'authentication module' },
      directoryPath: '/src/auth',
    })

    const fetched = await rpg.getNode('auth')
    expect(fetched).toBeDefined()
    expect(fetched!.id).toBe('auth')
    expect(fetched!.type).toBe('high_level')
    expect(fetched!.feature.description).toBe('authentication module')
    expect((fetched as HighLevelNode).directoryPath).toBe('/src/auth')
  })

  it('add and get low-level node', async () => {
    await rpg.addLowLevelNode({
      id: 'login',
      feature: { description: 'validate credentials', keywords: ['auth', 'login'] },
      metadata: { entityType: 'function', path: '/src/auth/login.ts' },
    })

    const fetched = await rpg.getNode('login')
    expect(fetched).toBeDefined()
    expect(fetched!.type).toBe('low_level')
    expect(fetched!.metadata?.entityType).toBe('function')
    expect(fetched!.feature.keywords).toEqual(['auth', 'login'])
  })

  it('add functional edge and getChildren', async () => {
    await rpg.addHighLevelNode({ id: 'root', feature: { description: 'root' } })
    await rpg.addHighLevelNode({ id: 'auth', feature: { description: 'auth' } })
    await rpg.addHighLevelNode({ id: 'api', feature: { description: 'api' } })

    await rpg.addFunctionalEdge({ source: 'root', target: 'auth', siblingOrder: 0 })
    await rpg.addFunctionalEdge({ source: 'root', target: 'api', siblingOrder: 1 })

    const children = await rpg.getChildren('root')
    expect(children).toHaveLength(2)
    expect(children[0].id).toBe('auth')
    expect(children[1].id).toBe('api')
  })

  it('getParent', async () => {
    await rpg.addHighLevelNode({ id: 'root', feature: { description: 'root' } })
    await rpg.addHighLevelNode({ id: 'child', feature: { description: 'child' } })
    await rpg.addFunctionalEdge({ source: 'root', target: 'child' })

    const parent = await rpg.getParent('child')
    expect(parent).toBeDefined()
    expect(parent!.id).toBe('root')
  })

  it('dependency edges', async () => {
    await rpg.addLowLevelNode({
      id: 'a',
      feature: { description: 'module A' },
      metadata: { path: '/src/a.ts' },
    })
    await rpg.addLowLevelNode({
      id: 'b',
      feature: { description: 'module B' },
      metadata: { path: '/src/b.ts' },
    })
    await rpg.addDependencyEdge({ source: 'a', target: 'b', dependencyType: 'import' })

    const deps = await rpg.getDependencies('a')
    expect(deps).toHaveLength(1)
    expect(deps[0].id).toBe('b')

    const dependents = await rpg.getDependents('b')
    expect(dependents).toHaveLength(1)
    expect(dependents[0].id).toBe('a')
  })

  it('searchByFeature', async () => {
    await rpg.addHighLevelNode({
      id: 'auth-mod',
      feature: { description: 'authentication and authorization module' },
    })
    await rpg.addLowLevelNode({
      id: 'api-route',
      feature: { description: 'API routing' },
      metadata: { path: '/src/api/router.ts' },
    })

    const results = await rpg.searchByFeature('authentication')
    expect(results.length).toBeGreaterThan(0)
    expect(results.some(n => n.id === 'auth-mod')).toBe(true)
  })

  it('searchByPath', async () => {
    await rpg.addLowLevelNode({
      id: 'login',
      feature: { description: 'login handler' },
      metadata: { path: '/src/auth/login.ts' },
    })
    await rpg.addLowLevelNode({
      id: 'router',
      feature: { description: 'api router' },
      metadata: { path: '/src/api/router.ts' },
    })

    const results = await rpg.searchByPath('/src/auth/*')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('login')
  })

  it('getStats', async () => {
    await rpg.addHighLevelNode({ id: 'hl', feature: { description: 'module' } })
    await rpg.addLowLevelNode({
      id: 'll',
      feature: { description: 'file' },
      metadata: { path: '/src/f.ts' },
    })
    await rpg.addFunctionalEdge({ source: 'hl', target: 'll' })

    const stats = await rpg.getStats()
    expect(stats.nodeCount).toBe(2)
    expect(stats.edgeCount).toBe(1)
    expect(stats.highLevelNodeCount).toBe(1)
    expect(stats.lowLevelNodeCount).toBe(1)
    expect(stats.functionalEdgeCount).toBe(1)
  })

  it('getTopologicalOrder', async () => {
    await rpg.addLowLevelNode({
      id: 'a',
      feature: { description: 'A' },
      metadata: { path: '/a.ts' },
    })
    await rpg.addLowLevelNode({
      id: 'b',
      feature: { description: 'B' },
      metadata: { path: '/b.ts' },
    })
    await rpg.addLowLevelNode({
      id: 'c',
      feature: { description: 'C' },
      metadata: { path: '/c.ts' },
    })
    await rpg.addDependencyEdge({ source: 'a', target: 'b', dependencyType: 'import' })
    await rpg.addDependencyEdge({ source: 'b', target: 'c', dependencyType: 'import' })

    const order = await rpg.getTopologicalOrder()
    const ids = order.map(n => n.id)
    expect(ids).toHaveLength(3)
    expect(ids).toContain('a')
    expect(ids).toContain('b')
    expect(ids).toContain('c')
  })

  it('serialize and deserialize roundtrip', async () => {
    await rpg.addHighLevelNode({ id: 'root', feature: { description: 'root module' } })
    await rpg.addLowLevelNode({
      id: 'file1',
      feature: { description: 'main file' },
      metadata: { path: '/src/main.ts' },
    })
    await rpg.addFunctionalEdge({ source: 'root', target: 'file1', siblingOrder: 0 })

    const serialized = await rpg.serialize()
    const rpg2 = await RepositoryPlanningGraph.deserialize(serialized)

    const nodes = await rpg2.getNodes()
    expect(nodes).toHaveLength(2)
    const edges = await rpg2.getEdges()
    expect(edges).toHaveLength(1)

    const root = await rpg2.getNode('root')
    expect(root).toBeDefined()
    expect(root!.feature.description).toBe('root module')

    await rpg2.close()
  })

  it('updateNode', async () => {
    await rpg.addLowLevelNode({
      id: 'n1',
      feature: { description: 'original' },
      metadata: { path: '/src/foo.ts' },
    })

    await rpg.updateNode('n1', {
      feature: { description: 'updated' },
    } as Partial<Node>)

    const fetched = await rpg.getNode('n1')
    expect(fetched!.feature.description).toBe('updated')
  })

  it('removeNode', async () => {
    await rpg.addHighLevelNode({ id: 'del', feature: { description: 'delete me' } })
    expect(await rpg.hasNode('del')).toBe(true)
    await rpg.removeNode('del')
    expect(await rpg.hasNode('del')).toBe(false)
  })
})
