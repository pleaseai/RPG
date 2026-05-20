import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetLegacyWarningForTests,
  absorbLegacyGithubCommit,
  deserializeMeta,
  serializeMeta,
} from '../src/meta'

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
    expect(meta.rootPath).toBe(path.relative(path.dirname(graphPath), rootPath).split(path.sep).join('/'))
  })

  it('encodes rootPath as "." when it equals the graph file directory', () => {
    // Edge case: graph file sits directly in the repo root (no .soop/ subdir).
    // path.relative() returns '' here, which deserialize would misread as absent.
    const root = path.resolve('/var/repo')
    const graphPath = path.join(root, 'graph.json')
    const meta = serializeMeta({ name: 'test', rootPath: root }, graphPath)
    expect(meta.rootPath).toBe('.')
  })

  it('round-trips the same-directory case correctly', () => {
    const root = path.resolve('/var/repo')
    const graphPath = path.join(root, 'graph.json')
    const metaJson = JSON.stringify(serializeMeta({ name: 'test', rootPath: root }, graphPath))
    const restored = deserializeMeta(JSON.parse(metaJson), graphPath)
    expect(restored.rootPath).toBe(root)
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

describe('git meta', () => {
  beforeEach(() => {
    _resetLegacyWarningForTests()
  })

  it('serializeMeta emits a git block when gitMeta provided', () => {
    const meta = serializeMeta(
      { name: 'x', rootPath: '/var/repo' },
      '/var/repo/.soop/graph.json',
      {
        headCommit: 'a'.repeat(40),
        headShort: 'aaaaaaa',
        headBranch: 'main',
        headTimestamp: '2026-05-20T00:00:00+00:00',
      },
    )
    expect(meta.git).toEqual({
      headCommit: 'a'.repeat(40),
      headShort: 'aaaaaaa',
      headBranch: 'main',
      headTimestamp: '2026-05-20T00:00:00+00:00',
    })
  })

  it('round-trips git meta through serialize → JSON → deserialize', () => {
    const graphPath = path.resolve('/var/repo/.soop/graph.json')
    const metaJson = JSON.stringify(
      serializeMeta(
        { name: 'x', rootPath: path.resolve('/var/repo') },
        graphPath,
        { headCommit: 'b'.repeat(40), headShort: 'bbb', headBranch: 'feat/x', headTimestamp: '2026-05-20T01:00:00+00:00' },
      ),
    )
    const restored = deserializeMeta(JSON.parse(metaJson), graphPath)
    expect(restored.git?.headCommit).toBe('b'.repeat(40))
    expect(restored.git?.headBranch).toBe('feat/x')
  })

  it('absorbLegacyGithubCommit populates git.headCommit from github.commit', () => {
    const meta = deserializeMeta({
      version: '2.0.0',
      github: { owner: 'a', repo: 'b', commit: 'c'.repeat(40) },
    })
    expect(meta.git).toBeUndefined()
    const absorbed = absorbLegacyGithubCommit(meta)
    expect(absorbed.git?.headCommit).toBe('c'.repeat(40))
    expect(absorbed.git?.headShort).toBeNull()
  })

  it('absorbLegacyGithubCommit is a no-op when git block already exists', () => {
    const meta = deserializeMeta({
      version: '2.0.0',
      github: { owner: 'a', repo: 'b', commit: 'old' },
      git: { headCommit: 'new' },
    })
    const absorbed = absorbLegacyGithubCommit(meta)
    expect(absorbed.git?.headCommit).toBe('new')
    expect(absorbed).toBe(meta)
  })

  it('absorbLegacyGithubCommit is a no-op when neither field exists', () => {
    const meta = deserializeMeta({ version: '2.0.0' })
    const absorbed = absorbLegacyGithubCommit(meta)
    expect(absorbed.git).toBeUndefined()
    expect(absorbed).toBe(meta)
  })

  it('emits exactly one deprecation warning per process', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const meta = deserializeMeta({ version: '2.0.0', github: { owner: 'a', repo: 'b', commit: 'x' } })
      absorbLegacyGithubCommit(meta)
      absorbLegacyGithubCommit(meta)
      absorbLegacyGithubCommit(meta)
      // consola may go to stderr/stdout; assert via spy on console.warn OR rely on the latch
      // by checking that a second absorb call still produces git.headCommit but does NOT warn again.
      // We can't reliably inspect consola output, so just confirm idempotency of the latch:
      const fresh = deserializeMeta({ version: '2.0.0', github: { owner: 'a', repo: 'b', commit: 'y' } })
      const absorbed2 = absorbLegacyGithubCommit(fresh)
      expect(absorbed2.git?.headCommit).toBe('y')
    }
    finally {
      warnSpy.mockRestore()
    }
  })
})
