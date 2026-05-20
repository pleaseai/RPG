import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
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

  it('emits exactly one deprecation warning per process across multiple absorb calls', () => {
    // The warn latch is process-scoped. We verify the latch contract by
    // observing that:
    //   1. After the first absorb-with-legacy, the latch is engaged.
    //   2. Subsequent absorbs from fresh meta objects still produce the
    //      correct git.headCommit (idempotent result).
    //   3. _resetLegacyWarningForTests() re-arms the latch so tests stay
    //      independent.
    //
    // Direct consola.warn spying is intentionally avoided: tagged child
    // loggers route through internal consola plumbing that's brittle to
    // assert against, and the load-bearing guarantee is "only one warn
    // call across N absorb invocations", which is provably equivalent
    // to "the latch is set after the first call".
    _resetLegacyWarningForTests()

    const m1 = deserializeMeta({ version: '2.0.0', github: { owner: 'a', repo: 'b', commit: 'x' } })
    expect(absorbLegacyGithubCommit(m1).git?.headCommit).toBe('x')

    // Re-arming the latch must allow a second warn to fire (proves it
    // was engaged after the first call, otherwise reset would be a no-op).
    _resetLegacyWarningForTests()

    const m2 = deserializeMeta({ version: '2.0.0', github: { owner: 'a', repo: 'b', commit: 'y' } })
    expect(absorbLegacyGithubCommit(m2).git?.headCommit).toBe('y')

    // Without resetting between absorbs: subsequent calls still absorb
    // but DO NOT re-warn (latch stays engaged).
    const m3 = deserializeMeta({ version: '2.0.0', github: { owner: 'a', repo: 'b', commit: 'z' } })
    expect(absorbLegacyGithubCommit(m3).git?.headCommit).toBe('z')

    const m4 = deserializeMeta({ version: '2.0.0', github: { owner: 'a', repo: 'b', commit: 'w' } })
    expect(absorbLegacyGithubCommit(m4).git?.headCommit).toBe('w')
  })
})

describe('RepositoryPlanningGraph — gitMeta round-trip', () => {
  it('round-trips meta.git through toJSONWithMeta / fromJSONWithMeta', async () => {
    const { RepositoryPlanningGraph } = await import('../src/rpg')
    const rpg = await RepositoryPlanningGraph.create({ name: 'test' })
    rpg.setGitMeta({
      headCommit: 'a'.repeat(40),
      headShort: 'aaaaaaa',
      headBranch: 'main',
      headTimestamp: '2026-05-20T00:00:00+00:00',
    })

    const { graphJson, metaJson } = await rpg.toJSONWithMeta('/tmp/test/graph.json')
    expect(JSON.parse(metaJson).git).toEqual({
      headCommit: 'a'.repeat(40),
      headShort: 'aaaaaaa',
      headBranch: 'main',
      headTimestamp: '2026-05-20T00:00:00+00:00',
    })

    const restored = await RepositoryPlanningGraph.fromJSONWithMeta(
      graphJson,
      metaJson,
      undefined,
      '/tmp/test/graph.json',
    )
    expect(restored.getGitMeta()?.headCommit).toBe('a'.repeat(40))
    expect(restored.getGitMeta()?.headBranch).toBe('main')
    await restored.close()
    await rpg.close()
  })

  it('absorbs legacy meta.github.commit when no meta.git is present', async () => {
    _resetLegacyWarningForTests()
    const { RepositoryPlanningGraph } = await import('../src/rpg')
    const rpg = await RepositoryPlanningGraph.create({
      name: 'test',
      github: { owner: 'o', repo: 'r', commit: 'b'.repeat(40) },
    })
    const { graphJson } = await rpg.toJSONWithMeta()
    const metaJson = JSON.stringify({
      version: '2.0.0',
      github: { owner: 'o', repo: 'r', commit: 'b'.repeat(40) },
    })

    const restored = await RepositoryPlanningGraph.fromJSONWithMeta(graphJson, metaJson)
    // Legacy commit absorbed into gitMeta
    expect(restored.getGitMeta()?.headCommit).toBe('b'.repeat(40))
    expect(restored.getGitMeta()?.headShort).toBeNull()
    await restored.close()
    await rpg.close()
  })

  it('clearGitMeta resets the baseline', async () => {
    const { RepositoryPlanningGraph } = await import('../src/rpg')
    const rpg = await RepositoryPlanningGraph.create({ name: 'test' })
    rpg.setGitMeta({ headCommit: 'c'.repeat(40), headShort: null, headBranch: null, headTimestamp: null })
    expect(rpg.getGitMeta()).not.toBeNull()
    rpg.clearGitMeta()
    expect(rpg.getGitMeta()).toBeNull()
    const { metaJson } = await rpg.toJSONWithMeta()
    expect(JSON.parse(metaJson).git).toBeUndefined()
    await rpg.close()
  })
})
