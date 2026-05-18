import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { deserializeMeta, serializeMeta } from '../src/meta'

describe('serializeMeta', () => {
  it('stores rootPath as relative-to-graph-directory when graphPath is provided', () => {
    const rootPath = path.resolve('/home/runner/work/soop/soop')
    const graphPath = path.join(rootPath, '.soop', 'graph.json')

    const meta = serializeMeta({ name: 'soop', rootPath }, graphPath)

    // Must NOT bake in the machine-specific absolute path
    expect(meta.rootPath).not.toBe(rootPath)
    expect(meta.rootPath).toBe('..')
  })

  it('falls back to absolute rootPath when graphPath is not provided (backward compat)', () => {
    const rootPath = path.resolve('/some/abs/path')
    const meta = serializeMeta({ name: 'test', rootPath })
    expect(meta.rootPath).toBe(rootPath)
  })

  it('omits rootPath when config has none', () => {
    const meta = serializeMeta({ name: 'test' }, '/anywhere/graph.json')
    expect(meta.rootPath).toBeUndefined()
  })

  it('handles rootPath outside the graph directory tree', () => {
    const rootPath = path.resolve('/var/data/repo')
    const graphPath = path.resolve('/var/other/place/graph.json')
    const meta = serializeMeta({ name: 'test', rootPath }, graphPath)
    // Resolves through .. — still portable when both sides share /var
    expect(meta.rootPath).toBe(path.relative(path.dirname(graphPath), rootPath))
  })
})

describe('deserializeMeta', () => {
  it('resolves a relative rootPath against the graph directory', () => {
    const graphPath = path.resolve('/Users/alice/projects/myrepo/.soop/graph.json')
    const meta = deserializeMeta({ version: '2.0.0', rootPath: '..' }, graphPath)
    expect(meta.rootPath).toBe(path.resolve('/Users/alice/projects/myrepo'))
  })

  it('preserves an absolute rootPath as-is (legacy meta files)', () => {
    const meta = deserializeMeta(
      { version: '2.0.0', rootPath: '/home/runner/work/soop/soop' },
      path.resolve('/Users/lms/dev/myrepo/.soop/graph.json'),
    )
    // Legacy absolute path stays absolute; caller fallback decides what to do.
    expect(meta.rootPath).toBe('/home/runner/work/soop/soop')
  })

  it('leaves rootPath untouched when graphPath is not provided', () => {
    const meta = deserializeMeta({ version: '2.0.0', rootPath: '..' })
    expect(meta.rootPath).toBe('..')
  })
})

describe('serialize → deserialize round-trip across machines', () => {
  it('produces the correct absolute rootPath on a different host', () => {
    // Machine A (e.g., CI)
    const hostARoot = path.resolve('/home/runner/work/soop/soop')
    const hostAGraph = path.join(hostARoot, '.soop', 'graph.json')
    const metaJson = JSON.stringify(
      serializeMeta({ name: 'soop', rootPath: hostARoot }, hostAGraph),
    )

    // Machine B (e.g., a contributor's laptop) — meta file copied/synced from git
    const hostBRoot = path.resolve('/Users/alice/projects/soop')
    const hostBGraph = path.join(hostBRoot, '.soop', 'graph.json')
    const restored = deserializeMeta(JSON.parse(metaJson), hostBGraph)

    expect(restored.rootPath).toBe(hostBRoot)
  })

  it('round-trips github metadata unchanged', () => {
    const graphPath = path.resolve('/var/repo/.soop/graph.json')
    const metaJson = JSON.stringify(
      serializeMeta(
        {
          name: 'soop',
          rootPath: path.resolve('/var/repo'),
          github: { owner: 'a', repo: 'b', commit: 'abc' },
        },
        graphPath,
      ),
    )
    const restored = deserializeMeta(JSON.parse(metaJson), graphPath)
    expect(restored.github).toEqual({ owner: 'a', repo: 'b', commit: 'abc' })
  })
})
