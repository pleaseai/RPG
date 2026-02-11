import type { LiftableEntity } from '../src/mcp/interactive/state'
import { beforeEach, describe, expect, it } from 'vitest'
import { InteractiveEncoder, jaccardDistance } from '../src/mcp/interactive/encoder'
import { InteractiveState } from '../src/mcp/interactive/state'

function makeEntity(id: string, sourceCode?: string): LiftableEntity {
  return {
    id,
    name: id.split(':').pop() ?? id,
    entityType: 'function',
    filePath: id.split(':')[0] ?? 'test.ts',
    sourceCode,
  }
}

describe('InteractiveState', () => {
  let state: InteractiveState

  beforeEach(() => {
    state = new InteractiveState()
  })

  describe('buildBatches', () => {
    it('should create a single batch for small entity lists', () => {
      state.entities = [
        makeEntity('a.ts:function:foo:1', 'const x = 1'),
        makeEntity('a.ts:function:bar:5', 'const y = 2'),
      ]
      state.buildBatches()
      expect(state.batchBoundaries).toEqual([[0, 2]])
    })

    it('should split batches by token budget', () => {
      // Each entity has ~5000 chars → ~1250 tokens. maxTokens = 2000 → 1 entity per batch
      const bigCode = 'x'.repeat(5000)
      state.entities = [
        makeEntity('a.ts:function:foo:1', bigCode),
        makeEntity('a.ts:function:bar:5', bigCode),
        makeEntity('a.ts:function:baz:10', bigCode),
      ]
      state.buildBatches(2000, 15)
      expect(state.batchBoundaries.length).toBe(3)
      expect(state.batchBoundaries[0]).toEqual([0, 1])
      expect(state.batchBoundaries[1]).toEqual([1, 2])
      expect(state.batchBoundaries[2]).toEqual([2, 3])
    })

    it('should split batches by max entity count', () => {
      state.entities = Array.from({ length: 10 }, (_, i) =>
        makeEntity(`a.ts:function:fn${i}:${i}`, 'short'))
      state.buildBatches(100_000, 3)
      expect(state.batchBoundaries.length).toBe(4)
      expect(state.batchBoundaries[0]).toEqual([0, 3])
      expect(state.batchBoundaries[1]).toEqual([3, 6])
      expect(state.batchBoundaries[2]).toEqual([6, 9])
      expect(state.batchBoundaries[3]).toEqual([9, 10])
    })

    it('should handle empty entity list', () => {
      state.entities = []
      state.buildBatches()
      expect(state.batchBoundaries).toEqual([])
    })

    it('should handle entities with no source code', () => {
      state.entities = [
        makeEntity('a.ts:function:foo:1', undefined),
        makeEntity('a.ts:function:bar:5', undefined),
      ]
      state.buildBatches()
      // Zero tokens per entity, so all fit in one batch
      expect(state.batchBoundaries).toEqual([[0, 2]])
    })
  })

  describe('coverage tracking', () => {
    it('should track lifted count and percentage', () => {
      state.entities = [
        makeEntity('a.ts:file'),
        makeEntity('a.ts:function:foo:1'),
        makeEntity('b.ts:file'),
        makeEntity('b.ts:function:bar:1'),
      ]

      expect(state.getLiftedCount()).toBe(0)
      expect(state.getCoveragePercent()).toBe(0)

      state.liftedFeatures.set('a.ts:file', ['module a'])
      state.liftedFeatures.set('a.ts:function:foo:1', ['do foo'])
      expect(state.getLiftedCount()).toBe(2)
      expect(state.getCoveragePercent()).toBe(50)

      state.liftedFeatures.set('b.ts:file', ['module b'])
      state.liftedFeatures.set('b.ts:function:bar:1', ['do bar'])
      expect(state.getLiftedCount()).toBe(4)
      expect(state.getCoveragePercent()).toBe(100)
    })

    it('should return 0% for empty entities', () => {
      expect(state.getCoveragePercent()).toBe(0)
    })
  })

  describe('getGraphRevision', () => {
    it('should return a deterministic revision hash', () => {
      state.entities = [makeEntity('a.ts:file')]
      const rev1 = state.getGraphRevision()
      const rev2 = state.getGraphRevision()
      expect(rev1).toBe(rev2)
      expect(rev1.length).toBe(12)
    })

    it('should change when state changes', () => {
      state.entities = [makeEntity('a.ts:file')]
      const rev1 = state.getGraphRevision()

      state.liftedFeatures.set('a.ts:file', ['description'])
      const rev2 = state.getGraphRevision()
      expect(rev2).not.toBe(rev1)
    })
  })

  describe('getBatchEntities', () => {
    it('should return correct entities for a batch index', () => {
      state.entities = Array.from({ length: 5 }, (_, i) =>
        makeEntity(`test.ts:function:fn${i}:${i}`, 'code'))
      state.buildBatches(100_000, 2)

      const batch0 = state.getBatchEntities(0)
      expect(batch0.length).toBe(2)
      expect(batch0[0]?.id).toBe('test.ts:function:fn0:0')
      expect(batch0[1]?.id).toBe('test.ts:function:fn1:1')

      const batch1 = state.getBatchEntities(1)
      expect(batch1.length).toBe(2)

      const batch2 = state.getBatchEntities(2)
      expect(batch2.length).toBe(1)
    })

    it('should return empty array for out-of-range batch', () => {
      state.entities = [makeEntity('a.ts:file')]
      state.buildBatches()
      expect(state.getBatchEntities(99)).toEqual([])
    })
  })

  describe('getEntitiesByScope', () => {
    it('should return all entities for wildcard scope', () => {
      state.entities = [
        makeEntity('src/a.ts:file'),
        makeEntity('lib/b.ts:file'),
      ]
      expect(state.getEntitiesByScope('*').length).toBe(2)
    })

    it('should filter by file path prefix', () => {
      state.entities = [
        makeEntity('src/a.ts:file'),
        makeEntity('src/b.ts:file'),
        makeEntity('lib/c.ts:file'),
      ]
      const srcEntities = state.getEntitiesByScope('src/')
      expect(srcEntities.length).toBe(2)
    })
  })

  describe('reset', () => {
    it('should clear all state', () => {
      state.entities = [makeEntity('a.ts:file')]
      state.liftedFeatures.set('a.ts:file', ['test'])
      state.pendingRouting = [{ entityId: 'a.ts:file', features: ['test'], currentPath: 'a.ts', reason: 'drifted' }]

      state.reset()

      expect(state.entities).toEqual([])
      expect(state.liftedFeatures.size).toBe(0)
      expect(state.pendingRouting).toEqual([])
      expect(state.batchBoundaries).toEqual([])
    })
  })
})

describe('Feature normalization', () => {
  it('should normalize features (lowercase, trim, dedup) via submitFeatures', async () => {
    const state = new InteractiveState()
    state.entities = [
      makeEntity('test.ts:main', 'function main() {}'),
    ]
    state.buildBatches()

    const encoder = new InteractiveEncoder(state)
    await encoder.submitFeatures(JSON.stringify({
      'test.ts:main': ['  Parse CLI Arguments ', 'parse cli arguments', 'Run Main Loop'],
    }))

    const stored = state.liftedFeatures.get('test.ts:main')
    expect(stored).toEqual(['parse cli arguments', 'run main loop'])
  })
})

describe('Jaccard distance', () => {
  it('should return 0 for identical sets', () => {
    const a = new Set(['a', 'b', 'c'])
    const b = new Set(['a', 'b', 'c'])
    expect(jaccardDistance(a, b)).toBe(0)
  })

  it('should return 1 for disjoint sets', () => {
    const a = new Set(['a', 'b'])
    const b = new Set(['c', 'd'])
    expect(jaccardDistance(a, b)).toBe(1)
  })

  it('should return 0 for empty sets', () => {
    expect(jaccardDistance(new Set(), new Set())).toBe(0)
  })

  it('should return correct value for partial overlap', () => {
    const a = new Set(['a', 'b', 'c'])
    const b = new Set(['b', 'c', 'd'])
    // intersection=2, union=4, distance=1-2/4=0.5
    expect(jaccardDistance(a, b)).toBe(0.5)
  })
})
