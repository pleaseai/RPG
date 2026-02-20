import { LocalGraphStore } from '@pleaseai/rpg-store/local'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('LocalGraphStore', () => {
  let store: LocalGraphStore

  beforeEach(async () => {
    store = new LocalGraphStore()
    await store.open({ path: 'memory' })
  })

  afterEach(async () => {
    await store.close()
  })

  // ==================== Node CRUD ====================

  it('addNode / getNode round-trip', async () => {
    await store.addNode('a', { label: 'Alpha', kind: 'file' })
    const attrs = await store.getNode('a')
    expect(attrs).toEqual({ label: 'Alpha', kind: 'file' })
  })

  it('getNode returns null for missing id', async () => {
    expect(await store.getNode('missing')).toBeNull()
  })

  it('hasNode returns true/false correctly', async () => {
    await store.addNode('x', {})
    expect(await store.hasNode('x')).toBe(true)
    expect(await store.hasNode('y')).toBe(false)
  })

  it('updateNode merges patch into existing attrs', async () => {
    await store.addNode('n', { a: 1, b: 2 })
    await store.updateNode('n', { b: 99, c: 3 })
    expect(await store.getNode('n')).toEqual({ a: 1, b: 99, c: 3 })
  })

  it('updateNode on missing id is a no-op', async () => {
    await expect(store.updateNode('ghost', { x: 1 })).resolves.toBeUndefined()
  })

  it('removeNode deletes the node', async () => {
    await store.addNode('del', {})
    await store.removeNode('del')
    expect(await store.hasNode('del')).toBe(false)
  })

  it('removeNode cascades to incident edges', async () => {
    await store.addNode('a', {})
    await store.addNode('b', {})
    await store.addEdge('a', 'b', { type: 'dep' })
    await store.removeNode('a')
    expect(await store.getEdges()).toHaveLength(0)
  })

  it('getNodes returns all nodes when no filter', async () => {
    await store.addNode('1', { kind: 'file' })
    await store.addNode('2', { kind: 'dir' })
    const all = await store.getNodes()
    expect(all).toHaveLength(2)
  })

  it('getNodes filters by attrs', async () => {
    await store.addNode('f1', { kind: 'file', lang: 'ts' })
    await store.addNode('f2', { kind: 'dir', lang: 'ts' })
    await store.addNode('f3', { kind: 'file', lang: 'py' })
    const files = await store.getNodes({ kind: 'file' })
    expect(files.map(n => n.id).sort()).toEqual(['f1', 'f3'])
  })

  // ==================== Edge CRUD ====================

  it('addEdge / getEdges round-trip', async () => {
    await store.addNode('a', {})
    await store.addNode('b', {})
    await store.addEdge('a', 'b', { type: 'calls', weight: 1 })
    const edges = await store.getEdges()
    expect(edges).toHaveLength(1)
    expect(edges[0]).toEqual({ source: 'a', target: 'b', attrs: { type: 'calls', weight: 1 } })
  })

  it('addEdge replaces edge with same identity', async () => {
    await store.addNode('a', {})
    await store.addNode('b', {})
    await store.addEdge('a', 'b', { type: 'dep', v: 1 })
    await store.addEdge('a', 'b', { type: 'dep', v: 2 })
    const edges = await store.getEdges()
    expect(edges).toHaveLength(1)
    expect(edges[0].attrs.v).toBe(2)
  })

  it('removeEdge deletes the matching edge', async () => {
    await store.addNode('a', {})
    await store.addNode('b', {})
    await store.addEdge('a', 'b', { type: 'dep' })
    await store.removeEdge('a', 'b', 'dep')
    expect(await store.getEdges()).toHaveLength(0)
  })

  it('getEdges filters by source', async () => {
    await store.addNode('a', {})
    await store.addNode('b', {})
    await store.addNode('c', {})
    await store.addEdge('a', 'b', { type: 'dep' })
    await store.addEdge('c', 'b', { type: 'dep' })
    const edges = await store.getEdges({ source: 'a' })
    expect(edges).toHaveLength(1)
    expect(edges[0].source).toBe('a')
  })

  it('getEdges filters by type', async () => {
    await store.addNode('a', {})
    await store.addNode('b', {})
    await store.addEdge('a', 'b', { type: 'calls' })
    await store.addEdge('a', 'b', { type: 'inherits' })
    const calls = await store.getEdges({ type: 'calls' })
    expect(calls).toHaveLength(1)
    expect(calls[0].attrs.type).toBe('calls')
  })

  // ==================== Neighbor Queries ====================

  it('getNeighbors direction=out', async () => {
    await store.addNode('a', {})
    await store.addNode('b', {})
    await store.addNode('c', {})
    await store.addEdge('a', 'b', { type: 'dep' })
    await store.addEdge('c', 'a', { type: 'dep' })
    const out = await store.getNeighbors('a', 'out')
    expect(out).toEqual(['b'])
  })

  it('getNeighbors direction=in', async () => {
    await store.addNode('a', {})
    await store.addNode('b', {})
    await store.addNode('c', {})
    await store.addEdge('a', 'b', { type: 'dep' })
    await store.addEdge('c', 'a', { type: 'dep' })
    const ins = await store.getNeighbors('a', 'in')
    expect(ins).toEqual(['c'])
  })

  it('getNeighbors direction=both', async () => {
    await store.addNode('a', {})
    await store.addNode('b', {})
    await store.addNode('c', {})
    await store.addEdge('a', 'b', { type: 'dep' })
    await store.addEdge('c', 'a', { type: 'dep' })
    const both = await store.getNeighbors('a', 'both')
    expect(both.sort()).toEqual(['b', 'c'])
  })

  it('getNeighbors filters by edgeType', async () => {
    await store.addNode('a', {})
    await store.addNode('b', {})
    await store.addNode('c', {})
    await store.addEdge('a', 'b', { type: 'calls' })
    await store.addEdge('a', 'c', { type: 'inherits' })
    const calls = await store.getNeighbors('a', 'out', 'calls')
    expect(calls).toEqual(['b'])
  })

  // ==================== Graph Traversal ====================

  it('traverse BFS up to maxDepth', async () => {
    // a → b → c → d
    await store.addNode('a', {})
    await store.addNode('b', {})
    await store.addNode('c', {})
    await store.addNode('d', {})
    await store.addEdge('a', 'b', { type: 'dep' })
    await store.addEdge('b', 'c', { type: 'dep' })
    await store.addEdge('c', 'd', { type: 'dep' })

    const result = await store.traverse('a', { direction: 'out', maxDepth: 2, edgeType: 'dep' })
    const ids = result.nodes.map(n => n.id).sort()
    expect(ids).toEqual(['b', 'c'])
    expect(result.maxDepthReached).toBe(2)
  })

  it('traverse does not include start node', async () => {
    await store.addNode('a', {})
    await store.addNode('b', {})
    await store.addEdge('a', 'b', { type: 'dep' })
    const result = await store.traverse('a', { direction: 'out', maxDepth: 1 })
    expect(result.nodes.map(n => n.id)).not.toContain('a')
  })

  it('traverse returns empty when no neighbors', async () => {
    await store.addNode('lone', {})
    const result = await store.traverse('lone', { direction: 'out', maxDepth: 3 })
    expect(result.nodes).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
  })

  it('traverse applies node filter', async () => {
    await store.addNode('a', {})
    await store.addNode('b', { kind: 'file' })
    await store.addNode('c', { kind: 'dir' })
    await store.addEdge('a', 'b', { type: 'dep' })
    await store.addEdge('a', 'c', { type: 'dep' })
    const result = await store.traverse('a', {
      direction: 'out',
      maxDepth: 1,
      filter: { kind: 'file' },
    })
    expect(result.nodes.map(n => n.id)).toEqual(['b'])
  })

  // ==================== Subgraph / Serialization ====================

  it('subgraph returns nodes and edges within set', async () => {
    await store.addNode('a', { v: 1 })
    await store.addNode('b', { v: 2 })
    await store.addNode('c', { v: 3 })
    await store.addEdge('a', 'b', { type: 'dep' })
    await store.addEdge('b', 'c', { type: 'dep' })

    const sg = await store.subgraph(['a', 'b'])
    expect(sg.nodes.map(n => n.id).sort()).toEqual(['a', 'b'])
    expect(sg.edges).toHaveLength(1)
    expect(sg.edges[0]).toMatchObject({ source: 'a', target: 'b' })
  })

  it('export / import round-trip', async () => {
    await store.addNode('x', { n: 42 })
    await store.addNode('y', { n: 7 })
    await store.addEdge('x', 'y', { type: 'link' })

    const exported = await store.export()

    const store2 = new LocalGraphStore()
    await store2.open({ path: 'memory' })
    await store2.import(exported)

    expect(await store2.getNode('x')).toEqual({ n: 42 })
    expect(await store2.getNode('y')).toEqual({ n: 7 })
    const edges = await store2.getEdges()
    expect(edges).toHaveLength(1)
    await store2.close()
  })

  // ==================== Persistence ====================

  it('persists data across close and reopen', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const dir = mkdtempSync(join(tmpdir(), 'rpg-lgs-test-'))
    try {
      const s1 = new LocalGraphStore()
      await s1.open({ path: dir })
      await s1.addNode('persist', { label: 'hello' })
      await s1.addNode('persist2', { label: 'world' })
      await s1.addEdge('persist', 'persist2', { type: 'link' })
      await s1.close()

      const s2 = new LocalGraphStore()
      await s2.open({ path: dir })
      expect(await s2.getNode('persist')).toEqual({ label: 'hello' })
      expect(await s2.getNode('persist2')).toEqual({ label: 'world' })
      const edges = await s2.getEdges()
      expect(edges).toHaveLength(1)
      await s2.close()
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
