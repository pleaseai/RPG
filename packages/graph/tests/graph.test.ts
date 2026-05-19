import {
  attrsToEdge,
  createDataFlowEdge,
  createDependencyEdge,
  createFunctionalEdge,
  createHighLevelNode,
  createLowLevelNode,
  edgeToAttrs,
  EdgeType,
  isDataFlowEdge,
  isDependencyEdge,
  isFunctionalEdge,
  isHighLevelNode,
  isLowLevelNode,
  NodeType,
  RepositoryPlanningGraph,
} from '@pleaseai/soop-graph'
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

  it('createDependencyEdge works with call dependency and symbol', () => {
    const edge = createDependencyEdge({
      source: 'module-a',
      target: 'module-b',
      dependencyType: 'call',
      symbol: 'myFunction',
    })

    expect(edge.source).toBe('module-a')
    expect(edge.target).toBe('module-b')
    expect(edge.dependencyType).toBe('call')
    expect(edge.symbol).toBe('myFunction')
  })

  it('createDependencyEdge works with inherit dependency and symbol', () => {
    const edge = createDependencyEdge({
      source: 'child-class',
      target: 'base-class',
      dependencyType: 'inherit',
      symbol: 'BaseClass',
      targetSymbol: 'ParentClass',
    })

    expect(edge.source).toBe('child-class')
    expect(edge.target).toBe('base-class')
    expect(edge.dependencyType).toBe('inherit')
    expect(edge.symbol).toBe('BaseClass')
    expect(edge.targetSymbol).toBe('ParentClass')
  })

  it('symbol survives serialize→deserialize round-trip via Python format', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'symbol-test' })

    await rpg.addLowLevelNode({
      id: 'file-a',
      feature: { description: 'file a' },
      metadata: { entityType: 'file', path: '/a.ts' },
    })
    await rpg.addLowLevelNode({
      id: 'file-b',
      feature: { description: 'file b' },
      metadata: { entityType: 'file', path: '/b.ts' },
    })

    await rpg.addDependencyEdge({
      source: 'file-a',
      target: 'file-b',
      dependencyType: 'call',
      symbol: 'myFunction',
    })

    const json = await rpg.toJSON()
    const restored = await RepositoryPlanningGraph.fromJSON(json)

    const depEdges = await restored.getDependencyEdges()
    expect(depEdges).toHaveLength(1)
    expect(depEdges[0]!.symbol).toBe('myFunction')
    expect(depEdges[0]!.dependencyType).toBe('call')
  })

  it('createDependencyEdge symbol and targetSymbol are optional', () => {
    const edge = createDependencyEdge({
      source: 'a',
      target: 'b',
      dependencyType: 'import',
    })

    expect(edge.symbol).toBeUndefined()
    expect(edge.targetSymbol).toBeUndefined()
    expect(edge.source).toBe('a')
    expect(edge.target).toBe('b')
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

  it('serialize sorts nodes by id', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'sort-test' })

    await rpg.addHighLevelNode({ id: 'zoo', feature: { description: 'zoo module' } })
    await rpg.addHighLevelNode({ id: 'alpha', feature: { description: 'alpha module' } })
    await rpg.addHighLevelNode({ id: 'middle', feature: { description: 'middle module' } })

    const serialized = await rpg.serialize()
    const ids = (serialized.nodes as Array<{ id: string }>).map(n => n.id)
    expect(ids).toEqual(ids.toSorted((a, b) => a.localeCompare(b)))
  })

  it('serialize sorts edges by src then dst', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'sort-test' })

    await rpg.addHighLevelNode({ id: 'b', feature: { description: 'b' } })
    await rpg.addHighLevelNode({ id: 'a', feature: { description: 'a' } })
    await rpg.addHighLevelNode({ id: 'c', feature: { description: 'c' } })

    await rpg.addFunctionalEdge({ source: 'b', target: 'c' })
    await rpg.addFunctionalEdge({ source: 'a', target: 'c' })
    await rpg.addFunctionalEdge({ source: 'a', target: 'b' })

    const serialized = await rpg.serialize()
    const pairs = (serialized.edges as Array<{ src: string, dst: string }>).map(
      e => `${e.src}→${e.dst}`,
    )
    expect(pairs).toEqual(['a→b', 'a→c', 'b→c'])
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

  it('preserves dep_graph_file through serialize → deserialize round trip', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'dep-trip' })
    rpg.setDepGraphFile('dep_graph.json')
    expect(rpg.getDepGraphFile()).toBe('dep_graph.json')

    const json = await rpg.toJSON()
    const parsed = JSON.parse(json) as { dep_graph_file?: string }
    expect(parsed.dep_graph_file).toBe('dep_graph.json')

    const restored = await RepositoryPlanningGraph.fromJSON(json)
    expect(restored.getDepGraphFile()).toBe('dep_graph.json')
  })

  it('omits dep_graph_file from serialized output when unset', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'no-dep' })
    const json = await rpg.toJSON()
    const parsed = JSON.parse(json) as Record<string, unknown>
    expect(parsed).not.toHaveProperty('dep_graph_file')
  })
})

describe('DataFlowEdge', () => {
  it('createDataFlowEdge creates valid edge with source/target', () => {
    const edge = createDataFlowEdge({
      source: 'module-a',
      target: 'module-b',
      dataId: 'UserData',
      dataType: 'import',
    })

    expect(edge.type).toBe(EdgeType.DataFlow)
    expect(edge.source).toBe('module-a')
    expect(edge.target).toBe('module-b')
    expect(edge.dataId).toBe('UserData')
    expect(edge.dataType).toBe('import')
    expect(isDataFlowEdge(edge)).toBe(true)
  })

  it('addDataFlowEdge stores edge in graph and getDataFlowEdges retrieves it', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })
    await rpg.addHighLevelNode({
      id: 'domain:auth',
      feature: { description: 'authentication module' },
    })
    await rpg.addHighLevelNode({
      id: 'domain:api',
      feature: { description: 'API module' },
    })

    await rpg.addDataFlowEdge({
      source: 'domain:auth',
      target: 'domain:api',
      dataId: 'AuthToken',
      dataType: 'token',
    })

    const edges = await rpg.getDataFlowEdges()
    expect(edges).toHaveLength(1)
    expect(edges[0].source).toBe('domain:auth')
    expect(edges[0].target).toBe('domain:api')
    expect(edges[0].dataId).toBe('AuthToken')
    expect(edges[0].dataType).toBe('token')
    expect(edges[0].type).toBe('data_flow')
  })

  it('data flow edges survive serialize → deserialize round-trip', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })
    await rpg.addHighLevelNode({
      id: 'domain:auth',
      feature: { description: 'authentication module' },
    })
    await rpg.addHighLevelNode({
      id: 'domain:api',
      feature: { description: 'API module' },
    })
    await rpg.addDataFlowEdge({
      source: 'domain:auth',
      target: 'domain:api',
      dataId: 'AuthToken',
      dataType: 'token',
      transformation: 'encode',
    })

    const serialized = await rpg.serialize()
    expect(serialized.data_flow).toBeDefined()
    expect(serialized.data_flow).toHaveLength(1)

    const json = await rpg.toJSON()
    const restored = await RepositoryPlanningGraph.fromJSON(json)

    const restoredEdges = await restored.getDataFlowEdges()
    expect(restoredEdges).toHaveLength(1)
    expect(restoredEdges[0].source).toBe('domain:auth')
    expect(restoredEdges[0].target).toBe('domain:api')
    expect(restoredEdges[0].dataId).toBe('AuthToken')
    expect(restoredEdges[0].dataType).toBe('token')
    expect(restoredEdges[0].transformation).toBe('encode')
  })

  it('data flow edges appear in getStats', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })
    await rpg.addHighLevelNode({
      id: 'domain:a',
      feature: { description: 'module a' },
    })
    await rpg.addHighLevelNode({
      id: 'domain:b',
      feature: { description: 'module b' },
    })
    await rpg.addDataFlowEdge({
      source: 'domain:a',
      target: 'domain:b',
      dataId: 'data',
      dataType: 'import',
    })

    const stats = await rpg.getStats()
    expect(stats.dataFlowEdgeCount).toBe(1)
  })

  it('deserializes Python format with data_flow', async () => {
    const pythonJson = JSON.stringify({
      repo_name: 'test-repo',
      repo_info: '',
      data_flow: [
        { source: 'domain:auth', target: 'domain:api', dataId: 'Token', dataType: 'auth' },
      ],
      excluded_files: [],
      repo_node_id: null,
      nodes: [
        { id: 'domain:auth', name: 'auth', node_type: 'functional_area', level: 1, meta: { type_name: 'directory', path: null, description: 'authentication module', content: '' } },
        { id: 'domain:api', name: 'api', node_type: 'functional_area', level: 1, meta: { type_name: 'directory', path: null, description: 'API module', content: '' } },
      ],
      edges: [],
      _dep_to_rpg_map: {},
      dep_graph: null,
    })

    const restored = await RepositoryPlanningGraph.fromJSON(pythonJson)
    const edges = await restored.getDataFlowEdges()
    expect(edges).toHaveLength(1)
    expect(edges[0].source).toBe('domain:auth')
    expect(edges[0].target).toBe('domain:api')
    expect(edges[0].dataId).toBe('Token')
  })

  it('data flow edges are in data_flow array, not edges', async () => {
    const rpg = await RepositoryPlanningGraph.create({ name: 'test-repo' })
    await rpg.addHighLevelNode({
      id: 'domain:a',
      feature: { description: 'module a' },
    })
    await rpg.addHighLevelNode({
      id: 'domain:b',
      feature: { description: 'module b' },
    })
    await rpg.addFunctionalEdge({ source: 'domain:a', target: 'domain:b' })
    await rpg.addDataFlowEdge({
      source: 'domain:a',
      target: 'domain:b',
      dataId: 'data',
      dataType: 'import',
    })

    const serialized = await rpg.serialize()
    // Regular edges should only have functional/dependency edges
    expect(serialized.edges).toHaveLength(1)
    // Data flow edges in data_flow array
    expect(serialized.data_flow).toHaveLength(1)
  })
})

describe('edgeToAttrs / attrsToEdge', () => {
  it('edgeToAttrs preserves symbol and targetSymbol for dependency edges', () => {
    const edge = createDependencyEdge({
      source: 'a',
      target: 'b',
      dependencyType: 'call',
      symbol: 'myFunction',
      targetSymbol: 'renamedFn',
      line: 10,
    })

    const attrs = edgeToAttrs(edge)

    expect(attrs.dep_symbol).toBe('myFunction')
    expect(attrs.dep_target_symbol).toBe('renamedFn')
    expect(attrs.dep_line).toBe(10)
    expect(attrs.dep_type).toBe('call')
    expect(attrs.type).toBe('dependency')
  })

  it('edgeToAttrs omits symbol fields when not set', () => {
    const edge = createDependencyEdge({
      source: 'a',
      target: 'b',
      dependencyType: 'import',
    })

    const attrs = edgeToAttrs(edge)

    expect(attrs.dep_symbol).toBeUndefined()
    expect(attrs.dep_target_symbol).toBeUndefined()
  })

  it('attrsToEdge reconstructs symbol and targetSymbol correctly', () => {
    const attrs = {
      type: 'dependency',
      dep_type: 'call',
      dep_symbol: 'myFunction',
      dep_target_symbol: 'renamedFn',
      dep_line: 10,
    }

    const edge = attrsToEdge('a', 'b', attrs)

    expect(edge.type).toBe('dependency')
    expect(edge.source).toBe('a')
    expect(edge.target).toBe('b')
    if (edge.type === 'dependency') {
      expect(edge.symbol).toBe('myFunction')
      expect(edge.targetSymbol).toBe('renamedFn')
      expect(edge.line).toBe(10)
      expect(edge.dependencyType).toBe('call')
    }
  })

  it('attrsToEdge round-trips dependency edge with symbol fields', () => {
    const original = createDependencyEdge({
      source: 'module-x',
      target: 'module-y',
      dependencyType: 'inherit',
      symbol: 'ChildClass',
      targetSymbol: 'BaseClass',
      line: 42,
    })

    const attrs = edgeToAttrs(original)
    const restored = attrsToEdge('module-x', 'module-y', attrs)

    expect(restored.type).toBe('dependency')
    if (restored.type === 'dependency') {
      expect(restored.symbol).toBe('ChildClass')
      expect(restored.targetSymbol).toBe('BaseClass')
      expect(restored.line).toBe(42)
      expect(restored.dependencyType).toBe('inherit')
    }
  })

  it('attrsToEdge round-trips functional edge', () => {
    const original = createFunctionalEdge({
      source: 'parent',
      target: 'child',
      level: 2,
      siblingOrder: 3,
    })

    const attrs = edgeToAttrs(original)
    const restored = attrsToEdge('parent', 'child', attrs)

    expect(restored.type).toBe('functional')
    if (restored.type === 'functional') {
      expect(restored.level).toBe(2)
      expect(restored.siblingOrder).toBe(3)
    }
  })

  it('edgeToAttrs converts data_flow edge to attrs', () => {
    const edge = createDataFlowEdge({
      source: 'a',
      target: 'b',
      dataId: 'user-data',
      dataType: 'UserModel',
      transformation: 'serialize',
    })

    const attrs = edgeToAttrs(edge)

    expect(attrs.type).toBe('data_flow')
    expect(attrs.df_data_id).toBe('user-data')
    expect(attrs.df_data_type).toBe('UserModel')
    expect(attrs.df_transformation).toBe('serialize')
  })

  it('attrsToEdge round-trips data_flow edge', () => {
    const original = createDataFlowEdge({
      source: 'src/auth.ts:file',
      target: 'src/user.ts:file',
      dataId: 'token',
      dataType: 'string',
    })

    const attrs = edgeToAttrs(original)
    const restored = attrsToEdge('src/auth.ts:file', 'src/user.ts:file', attrs)

    expect(restored.type).toBe('data_flow')
    if (restored.type === 'data_flow') {
      expect(restored.dataId).toBe('token')
      expect(restored.dataType).toBe('string')
      expect(restored.transformation).toBeUndefined()
    }
  })

  it('attrsToEdge round-trips data_flow edge with transformation', () => {
    const original = createDataFlowEdge({
      source: 'src/parser.ts:file',
      target: 'src/formatter.ts:file',
      dataId: 'ast',
      dataType: 'ASTNode',
      transformation: 'stringify',
    })

    const attrs = edgeToAttrs(original)
    const restored = attrsToEdge('src/parser.ts:file', 'src/formatter.ts:file', attrs)

    expect(restored.type).toBe('data_flow')
    if (restored.type === 'data_flow') {
      expect(restored.dataId).toBe('ast')
      expect(restored.dataType).toBe('ASTNode')
      expect(restored.transformation).toBe('stringify')
    }
  })
})
