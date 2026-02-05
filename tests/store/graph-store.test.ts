import type { GraphStore } from '../../src/store/graph-store'
import type { EdgeAttrs, NodeAttrs } from '../../src/store/types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLiteGraphStore } from '../../src/store/sqlite/graph-store'
import { SurrealGraphStore } from '../../src/store/surreal/graph-store'

// ==================== Test Fixtures ====================

function makeNodeAttrs(type: string, desc: string, extra?: Record<string, unknown>): NodeAttrs {
  return { type, feature_desc: desc, ...extra }
}

function makeFuncEdgeAttrs(siblingOrder?: number): EdgeAttrs {
  return { type: 'functional', ...(siblingOrder != null ? { sibling_order: siblingOrder } : {}) }
}

function makeDepEdgeAttrs(depType = 'import'): EdgeAttrs {
  return { type: 'dependency', dep_type: depType }
}

// ==================== Shared Test Suite ====================

function runGraphStoreTests(name: string, createStore: () => GraphStore) {
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
        await store.addNode('n1', makeNodeAttrs('high_level', 'test node'))
        const attrs = await store.getNode('n1')
        expect(attrs).not.toBeNull()
        expect(attrs!.type).toBe('high_level')
        expect(attrs!.feature_desc).toBe('test node')
      })

      it('getNode returns null for missing', async () => {
        expect(await store.getNode('missing')).toBeNull()
      })

      it('hasNode', async () => {
        await store.addNode('x', makeNodeAttrs('low_level', 'x'))
        expect(await store.hasNode('x')).toBe(true)
        expect(await store.hasNode('y')).toBe(false)
      })

      it('updateNode merges attrs', async () => {
        await store.addNode('n1', makeNodeAttrs('low_level', 'original'))
        await store.updateNode('n1', { feature_desc: 'updated' })
        const attrs = await store.getNode('n1')
        expect(attrs!.feature_desc).toBe('updated')
        expect(attrs!.type).toBe('low_level')
      })

      it('removeNode', async () => {
        await store.addNode('del', makeNodeAttrs('high_level', 'delete me'))
        await store.removeNode('del')
        expect(await store.hasNode('del')).toBe(false)
      })

      it('getNodes with filter', async () => {
        await store.addNode('hl1', makeNodeAttrs('high_level', 'A'))
        await store.addNode('hl2', makeNodeAttrs('high_level', 'B'))
        await store.addNode('ll1', makeNodeAttrs('low_level', 'C'))

        const hl = await store.getNodes({ type: 'high_level' })
        expect(hl).toHaveLength(2)

        const ll = await store.getNodes({ type: 'low_level' })
        expect(ll).toHaveLength(1)
      })

      it('getNodes returns all without filter', async () => {
        await store.addNode('a', makeNodeAttrs('high_level', 'A'))
        await store.addNode('b', makeNodeAttrs('low_level', 'B'))
        const all = await store.getNodes()
        expect(all).toHaveLength(2)
      })
    })

    // ==================== Edge CRUD ====================

    describe('edge CRUD', () => {
      beforeEach(async () => {
        await store.addNode('p', makeNodeAttrs('high_level', 'parent'))
        await store.addNode('c1', makeNodeAttrs('low_level', 'child1'))
        await store.addNode('c2', makeNodeAttrs('low_level', 'child2'))
      })

      it('addEdge and getEdges', async () => {
        await store.addEdge('p', 'c1', makeFuncEdgeAttrs(0))
        const edges = await store.getEdges({ type: 'functional' })
        expect(edges).toHaveLength(1)
        expect(edges[0].source).toBe('p')
        expect(edges[0].target).toBe('c1')
      })

      it('addEdge dependency', async () => {
        await store.addEdge('c1', 'c2', makeDepEdgeAttrs('import'))
        const edges = await store.getEdges({ type: 'dependency' })
        expect(edges).toHaveLength(1)
        expect(edges[0].attrs.dep_type).toBe('import')
      })

      it('removeEdge', async () => {
        await store.addEdge('p', 'c1', makeFuncEdgeAttrs())
        await store.removeEdge('p', 'c1', 'functional')
        const edges = await store.getEdges({ type: 'functional' })
        expect(edges).toHaveLength(0)
      })

      it('getEdges with source filter', async () => {
        await store.addEdge('p', 'c1', makeFuncEdgeAttrs(0))
        await store.addEdge('p', 'c2', makeFuncEdgeAttrs(1))
        const edges = await store.getEdges({ source: 'p', type: 'functional' })
        expect(edges).toHaveLength(2)
      })

      it('getEdges with target filter', async () => {
        await store.addEdge('p', 'c1', makeFuncEdgeAttrs())
        const edges = await store.getEdges({ target: 'c1', type: 'functional' })
        expect(edges).toHaveLength(1)
        expect(edges[0].source).toBe('p')
      })
    })

    // ==================== Neighbor Queries ====================

    describe('neighbors', () => {
      beforeEach(async () => {
        await store.addNode('root', makeNodeAttrs('high_level', 'root'))
        await store.addNode('a', makeNodeAttrs('high_level', 'A'))
        await store.addNode('b', makeNodeAttrs('low_level', 'B'))

        await store.addEdge('root', 'a', makeFuncEdgeAttrs(0))
        await store.addEdge('root', 'b', makeFuncEdgeAttrs(1))
        await store.addEdge('a', 'b', makeDepEdgeAttrs())
      })

      it('getNeighbors out', async () => {
        const neighbors = await store.getNeighbors('root', 'out', 'functional')
        expect(neighbors.sort()).toEqual(['a', 'b'])
      })

      it('getNeighbors in', async () => {
        const neighbors = await store.getNeighbors('a', 'in', 'functional')
        expect(neighbors).toEqual(['root'])
      })

      it('getNeighbors both', async () => {
        const neighbors = await store.getNeighbors('a', 'both')
        expect(neighbors.sort()).toEqual(['b', 'root'])
      })
    })

    // ==================== Traversal ====================

    describe('traversal', () => {
      beforeEach(async () => {
        await store.addNode('root', makeNodeAttrs('high_level', 'root'))
        await store.addNode('a', makeNodeAttrs('high_level', 'A'))
        await store.addNode('b', makeNodeAttrs('low_level', 'B'))
        await store.addNode('c', makeNodeAttrs('low_level', 'C'))

        await store.addEdge('root', 'a', makeFuncEdgeAttrs())
        await store.addEdge('a', 'b', makeFuncEdgeAttrs())
        await store.addEdge('b', 'c', makeDepEdgeAttrs())
      })

      it('traverse out with functional edges', async () => {
        const result = await store.traverse('root', {
          direction: 'out',
          edgeType: 'functional',
          maxDepth: 2,
        })
        const ids = result.nodes.map(n => n.id).sort()
        expect(ids).toContain('a')
        expect(ids).toContain('b')
        expect(result.maxDepthReached).toBe(2)
      })

      it('traverse respects maxDepth', async () => {
        const result = await store.traverse('root', {
          direction: 'out',
          edgeType: 'functional',
          maxDepth: 1,
        })
        const ids = result.nodes.map(n => n.id)
        expect(ids).toContain('a')
        expect(ids).not.toContain('b')
      })
    })

    // ==================== Serialization ====================

    describe('import/Export', () => {
      it('export and import roundtrip', async () => {
        await store.addNode('n1', makeNodeAttrs('high_level', 'module'))
        await store.addNode('n2', makeNodeAttrs('low_level', 'file'))
        await store.addEdge('n1', 'n2', makeFuncEdgeAttrs(0))

        const exported = await store.export()
        expect(exported.nodes).toHaveLength(2)
        expect(exported.edges).toHaveLength(1)

        // Create a fresh store and import
        const store2 = createStore()
        await store2.open('memory')
        await store2.import(exported)

        expect(await store2.hasNode('n1')).toBe(true)
        expect(await store2.hasNode('n2')).toBe(true)
        const edges = await store2.getEdges()
        expect(edges).toHaveLength(1)

        await store2.close()
      })
    })

    // ==================== Subgraph ====================

    describe('subgraph', () => {
      it('subgraph extracts node subset with internal edges', async () => {
        await store.addNode('a', makeNodeAttrs('high_level', 'A'))
        await store.addNode('b', makeNodeAttrs('low_level', 'B'))
        await store.addNode('c', makeNodeAttrs('low_level', 'C'))
        await store.addEdge('a', 'b', makeFuncEdgeAttrs())
        await store.addEdge('b', 'c', makeDepEdgeAttrs())

        const sub = await store.subgraph(['a', 'b'])
        expect(sub.nodes).toHaveLength(2)
        // Only the a->b edge should be included, not b->c
        expect(sub.edges).toHaveLength(1)
        expect(sub.edges[0].source).toBe('a')
        expect(sub.edges[0].target).toBe('b')
      })
    })
  })
}

// ==================== Run for each implementation ====================

runGraphStoreTests('SQLiteGraphStore', () => new SQLiteGraphStore())
runGraphStoreTests('SurrealGraphStore', () => new SurrealGraphStore())
