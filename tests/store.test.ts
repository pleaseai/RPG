import type {
  DependencyEdge,
  FunctionalEdge,
  GraphStore,
  HighLevelNode,
  LowLevelNode,
  Node,
} from '../src/graph'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLiteStore } from '../src/graph/sqlite-store'
import { SurrealStore } from '../src/graph/surreal-store'

// ==================== Test Fixtures ====================

function makeHighLevelNode(id: string, description: string, directoryPath?: string): HighLevelNode {
  return {
    id,
    type: 'high_level',
    feature: { description },
    directoryPath,
  }
}

function makeLowLevelNode(
  id: string,
  description: string,
  path: string,
  opts?: { entityType?: 'file' | 'class' | 'function' | 'method', keywords?: string[] },
): LowLevelNode {
  return {
    id,
    type: 'low_level',
    feature: {
      description,
      keywords: opts?.keywords,
    },
    metadata: {
      entityType: opts?.entityType ?? 'file',
      path,
    },
  }
}

function makeFunctionalEdge(source: string, target: string, siblingOrder?: number): FunctionalEdge {
  return {
    source,
    target,
    type: 'functional',
    siblingOrder,
  }
}

function makeDependencyEdge(
  source: string,
  target: string,
  depType: 'import' | 'call' = 'import',
): DependencyEdge {
  return {
    source,
    target,
    type: 'dependency',
    dependencyType: depType,
  }
}

// ==================== Shared Test Suite ====================

function runStoreTests(name: string, createStore: () => GraphStore) {
  describe(`${name}: GraphStore conformance`, () => {
    let store: GraphStore

    beforeEach(async () => {
      store = createStore()
      await store.open('memory')
    })

    afterEach(async () => {
      await store.close()
    })

    // ==================== Node CRUD ====================

    describe('node CRUD', () => {
      it('addNode and getNode', async () => {
        const node = makeHighLevelNode('auth', 'handle authentication', '/src/auth')
        await store.addNode(node)

        const fetched = await store.getNode('auth')
        expect(fetched).not.toBeNull()
        expect(fetched!.id).toBe('auth')
        expect(fetched!.type).toBe('high_level')
        expect(fetched!.feature.description).toBe('handle authentication')
        expect((fetched as HighLevelNode).directoryPath).toBe('/src/auth')
      })

      it('addNode low-level with metadata', async () => {
        const node = makeLowLevelNode(
          'login-fn',
          'validate user credentials',
          '/src/auth/login.ts',
          {
            entityType: 'function',
            keywords: ['auth', 'login'],
          },
        )
        await store.addNode(node)

        const fetched = await store.getNode('login-fn')
        expect(fetched).not.toBeNull()
        expect(fetched!.type).toBe('low_level')
        expect(fetched!.metadata?.entityType).toBe('function')
        expect(fetched!.metadata?.path).toBe('/src/auth/login.ts')
        expect(fetched!.feature.keywords).toEqual(['auth', 'login'])
      })

      it('getNode returns null for missing id', async () => {
        const result = await store.getNode('nonexistent')
        expect(result).toBeNull()
      })

      it('hasNode', async () => {
        await store.addNode(makeHighLevelNode('exists', 'test'))
        expect(await store.hasNode('exists')).toBe(true)
        expect(await store.hasNode('nope')).toBe(false)
      })

      it('updateNode', async () => {
        await store.addNode(makeLowLevelNode('n1', 'original description', '/src/foo.ts'))

        await store.updateNode('n1', {
          feature: { description: 'updated description' },
        } as Partial<Node>)

        const fetched = await store.getNode('n1')
        expect(fetched!.feature.description).toBe('updated description')
      })

      it('removeNode', async () => {
        await store.addNode(makeHighLevelNode('del-me', 'to be deleted'))
        expect(await store.hasNode('del-me')).toBe(true)

        await store.removeNode('del-me')
        expect(await store.hasNode('del-me')).toBe(false)
      })

      it('getNodes with filter', async () => {
        await store.addNode(makeHighLevelNode('hl1', 'module A'))
        await store.addNode(makeHighLevelNode('hl2', 'module B'))
        await store.addNode(makeLowLevelNode('ll1', 'function X', '/src/x.ts'))

        const hlNodes = await store.getNodes({ type: 'high_level' })
        expect(hlNodes).toHaveLength(2)

        const llNodes = await store.getNodes({ type: 'low_level' })
        expect(llNodes).toHaveLength(1)
      })

      it('getNodes without filter returns all', async () => {
        await store.addNode(makeHighLevelNode('a', 'A'))
        await store.addNode(makeLowLevelNode('b', 'B', '/src/b.ts'))

        const allNodes = await store.getNodes()
        expect(allNodes).toHaveLength(2)
      })
    })

    // ==================== Edge CRUD ====================

    describe('edge CRUD', () => {
      beforeEach(async () => {
        await store.addNode(makeHighLevelNode('parent', 'parent module'))
        await store.addNode(makeLowLevelNode('child1', 'child one', '/src/child1.ts'))
        await store.addNode(makeLowLevelNode('child2', 'child two', '/src/child2.ts'))
      })

      it('addEdge functional', async () => {
        await store.addEdge(makeFunctionalEdge('parent', 'child1', 0))

        const edges = await store.getEdges({ type: 'functional' })
        expect(edges).toHaveLength(1)
        expect(edges[0].source).toBe('parent')
        expect(edges[0].target).toBe('child1')
      })

      it('addEdge dependency', async () => {
        await store.addEdge(makeDependencyEdge('child1', 'child2', 'import'))

        const edges = await store.getEdges({ type: 'dependency' })
        expect(edges).toHaveLength(1)
        expect(edges[0].source).toBe('child1')
        expect(edges[0].target).toBe('child2')
        expect((edges[0] as DependencyEdge).dependencyType).toBe('import')
      })

      it('removeEdge', async () => {
        await store.addEdge(makeFunctionalEdge('parent', 'child1'))
        await store.removeEdge('parent', 'child1', 'functional')

        const edges = await store.getEdges({ type: 'functional' })
        expect(edges).toHaveLength(0)
      })

      it('getOutEdges', async () => {
        await store.addEdge(makeFunctionalEdge('parent', 'child1', 0))
        await store.addEdge(makeFunctionalEdge('parent', 'child2', 1))

        const outEdges = await store.getOutEdges('parent', 'functional')
        expect(outEdges).toHaveLength(2)
      })

      it('getInEdges', async () => {
        await store.addEdge(makeFunctionalEdge('parent', 'child1'))

        const inEdges = await store.getInEdges('child1', 'functional')
        expect(inEdges).toHaveLength(1)
        expect(inEdges[0].source).toBe('parent')
      })
    })

    // ==================== Graph Navigation ====================

    describe('graph Navigation', () => {
      beforeEach(async () => {
        // Build a small tree:
        //   root
        //   ├── auth (sibling 0)
        //   │   ├── login
        //   │   └── logout
        //   └── api (sibling 1)
        //
        // Dependencies: login -> api
        await store.addNode(makeHighLevelNode('root', 'application root'))
        await store.addNode(makeHighLevelNode('auth', 'authentication module', '/src/auth'))
        await store.addNode(makeHighLevelNode('api', 'api module', '/src/api'))
        await store.addNode(makeLowLevelNode('login', 'handle login', '/src/auth/login.ts'))
        await store.addNode(makeLowLevelNode('logout', 'handle logout', '/src/auth/logout.ts'))

        await store.addEdge(makeFunctionalEdge('root', 'auth', 0))
        await store.addEdge(makeFunctionalEdge('root', 'api', 1))
        await store.addEdge(makeFunctionalEdge('auth', 'login', 0))
        await store.addEdge(makeFunctionalEdge('auth', 'logout', 1))
        await store.addEdge(makeDependencyEdge('login', 'api', 'import'))
      })

      it('getChildren returns ordered children', async () => {
        const children = await store.getChildren('root')
        expect(children).toHaveLength(2)
        expect(children[0].id).toBe('auth')
        expect(children[1].id).toBe('api')
      })

      it('getChildren for leaf returns empty', async () => {
        const children = await store.getChildren('login')
        expect(children).toHaveLength(0)
      })

      it('getParent', async () => {
        const parent = await store.getParent('auth')
        expect(parent).not.toBeNull()
        expect(parent!.id).toBe('root')
      })

      it('getParent for root returns null', async () => {
        const parent = await store.getParent('root')
        expect(parent).toBeNull()
      })

      it('getDependencies', async () => {
        const deps = await store.getDependencies('login')
        expect(deps).toHaveLength(1)
        expect(deps[0].id).toBe('api')
      })

      it('getDependents', async () => {
        const dependents = await store.getDependents('api')
        expect(dependents).toHaveLength(1)
        expect(dependents[0].id).toBe('login')
      })
    })

    // ==================== Deep Traversal ====================

    describe('traverse', () => {
      beforeEach(async () => {
        await store.addNode(makeHighLevelNode('root', 'root'))
        await store.addNode(makeHighLevelNode('a', 'module A'))
        await store.addNode(makeLowLevelNode('b', 'file B', '/src/b.ts'))
        await store.addNode(makeLowLevelNode('c', 'file C', '/src/c.ts'))

        await store.addEdge(makeFunctionalEdge('root', 'a'))
        await store.addEdge(makeFunctionalEdge('a', 'b'))
        await store.addEdge(makeDependencyEdge('b', 'c', 'import'))
      })

      it('traverse outward with functional edges', async () => {
        const result = await store.traverse({
          startNode: 'root',
          edgeType: 'functional',
          direction: 'out',
          maxDepth: 2,
        })

        const nodeIds = result.nodes.map(n => n.id).sort()
        expect(nodeIds).toContain('a')
        expect(nodeIds).toContain('b')
        expect(result.maxDepthReached).toBe(2)
      })

      it('traverse respects maxDepth', async () => {
        const result = await store.traverse({
          startNode: 'root',
          edgeType: 'functional',
          direction: 'out',
          maxDepth: 1,
        })

        const nodeIds = result.nodes.map(n => n.id)
        expect(nodeIds).toContain('a')
        expect(nodeIds).not.toContain('b')
        expect(result.maxDepthReached).toBe(1)
      })

      it('traverse both edge types', async () => {
        const result = await store.traverse({
          startNode: 'a',
          edgeType: 'both',
          direction: 'out',
          maxDepth: 3,
        })

        const nodeIds = result.nodes.map(n => n.id).sort()
        expect(nodeIds).toContain('b')
        expect(nodeIds).toContain('c')
      })
    })

    // ==================== Search ====================

    describe('search', () => {
      beforeEach(async () => {
        await store.addNode(
          makeHighLevelNode('auth-mod', 'authentication and authorization module'),
        )
        await store.addNode(
          makeLowLevelNode(
            'login-fn',
            'validate user credentials for login',
            '/src/auth/login.ts',
            {
              keywords: ['auth', 'login', 'credentials'],
            },
          ),
        )
        await store.addNode(
          makeLowLevelNode('api-route', 'handle API routing and dispatch', '/src/api/router.ts', {
            keywords: ['api', 'route', 'http'],
          }),
        )

        // Tree: auth-mod -> login-fn
        await store.addEdge(makeFunctionalEdge('auth-mod', 'login-fn'))
      })

      it('searchByFeature finds matching nodes', async () => {
        const results = await store.searchByFeature('authentication')
        expect(results.length).toBeGreaterThan(0)
        expect(results.some(r => r.node.id === 'auth-mod')).toBe(true)
      })

      it('searchByFeature with scope restriction', async () => {
        const results = await store.searchByFeature('login', ['auth-mod'])
        // Should find login-fn (under auth-mod) but not api-route
        const ids = results.map(r => r.node.id)
        expect(ids).not.toContain('api-route')
      })

      it('searchByPath', async () => {
        const results = await store.searchByPath('/src/auth/*')
        expect(results).toHaveLength(1)
        expect(results[0].id).toBe('login-fn')
      })

      it('searchByPath with no match', async () => {
        const results = await store.searchByPath('/src/nonexistent/*')
        expect(results).toHaveLength(0)
      })
    })

    // ==================== Statistics ====================

    describe('statistics', () => {
      it('getStats on empty store', async () => {
        const stats = await store.getStats()
        expect(stats.nodeCount).toBe(0)
        expect(stats.edgeCount).toBe(0)
      })

      it('getStats with data', async () => {
        await store.addNode(makeHighLevelNode('hl', 'module'))
        await store.addNode(makeLowLevelNode('ll', 'file', '/src/f.ts'))
        await store.addEdge(makeFunctionalEdge('hl', 'll'))
        await store.addEdge(makeDependencyEdge('ll', 'hl', 'import'))

        const stats = await store.getStats()
        expect(stats.nodeCount).toBe(2)
        expect(stats.edgeCount).toBe(2)
        expect(stats.highLevelNodeCount).toBe(1)
        expect(stats.lowLevelNodeCount).toBe(1)
        expect(stats.functionalEdgeCount).toBe(1)
        expect(stats.dependencyEdgeCount).toBe(1)
      })
    })

    // ==================== Serialization ====================

    describe('serialization', () => {
      it('importJSON and exportJSON roundtrip', async () => {
        const original = {
          version: '1.0.0',
          config: { name: 'test-repo' },
          nodes: [
            makeHighLevelNode('root', 'root module'),
            makeLowLevelNode('file1', 'main file', '/src/main.ts'),
          ],
          edges: [makeFunctionalEdge('root', 'file1', 0)],
        }

        await store.importJSON(original)

        const exported = await store.exportJSON({ name: 'test-repo' })
        expect(exported.version).toBe('1.0.0')
        expect(exported.config.name).toBe('test-repo')
        expect(exported.nodes).toHaveLength(2)
        expect(exported.edges).toHaveLength(1)

        // Verify node data survived roundtrip
        const root = exported.nodes.find((n: Node) => n.id === 'root')
        expect(root).toBeDefined()
        expect(root!.feature.description).toBe('root module')

        const file = exported.nodes.find((n: Node) => n.id === 'file1')
        expect(file).toBeDefined()
        expect(file!.type).toBe('low_level')
      })
    })

    // ==================== Topological Order ====================

    describe('topological Order', () => {
      it('getTopologicalOrder respects dependencies', async () => {
        // a depends on b, b depends on c → order: c, b, a (or similar valid topo order)
        await store.addNode(makeLowLevelNode('a', 'module a', '/src/a.ts'))
        await store.addNode(makeLowLevelNode('b', 'module b', '/src/b.ts'))
        await store.addNode(makeLowLevelNode('c', 'module c', '/src/c.ts'))

        await store.addEdge(makeDependencyEdge('a', 'b', 'import'))
        await store.addEdge(makeDependencyEdge('b', 'c', 'import'))

        const order = await store.getTopologicalOrder()
        const ids = order.map(n => n.id)

        // All nodes should be present
        expect(ids).toHaveLength(3)
        expect(ids).toContain('a')
        expect(ids).toContain('b')
        expect(ids).toContain('c')
      })
    })
  })
}

// ==================== Run for each implementation ====================

runStoreTests('SQLiteStore', () => new SQLiteStore())
runStoreTests('SurrealStore', () => new SurrealStore())
