import { pathToModule, toVendorDepGraph } from '@pleaseai/soop-encoder'
import { RepositoryPlanningGraph } from '@pleaseai/soop-graph'
import { describe, expect, it } from 'vitest'

describe('pathToModule', () => {
  it('drops the file extension and joins with dots', () => {
    expect(pathToModule('src/foo/bar.ts')).toBe('src.foo.bar')
    expect(pathToModule('pkg/mod.py')).toBe('pkg.mod')
  })

  it('collapses __init__.py to its parent module', () => {
    expect(pathToModule('pkg/__init__.py')).toBe('pkg')
  })

  it('returns empty string for the root sentinel', () => {
    expect(pathToModule('.')).toBe('')
    expect(pathToModule('')).toBe('')
  })

  it('drops everything past the first colon (entity suffix)', () => {
    expect(pathToModule('src/foo.ts:Bar')).toBe('src.foo')
  })
})

describe('toVendorDepGraph', () => {
  async function buildRpg(): Promise<RepositoryPlanningGraph> {
    const rpg = await RepositoryPlanningGraph.create({ name: 'sample-repo' })

    // Mirror the structure used by the visualize fixture.
    await rpg.addLowLevelNode({
      id: 'src/util.ts',
      feature: { description: 'utility module' },
      metadata: { entityType: 'file', path: 'src/util.ts' },
    })
    await rpg.addLowLevelNode({
      id: 'src/util.ts:class:Calculator:1',
      feature: { description: 'calculator class' },
      metadata: {
        entityType: 'class',
        path: 'src/util.ts',
        qualifiedName: 'Calculator',
      },
    })
    await rpg.addLowLevelNode({
      id: 'src/util.ts:method:Calculator.add:5',
      feature: { description: 'add method' },
      metadata: {
        entityType: 'method',
        path: 'src/util.ts',
        qualifiedName: 'Calculator.add',
      },
    })
    await rpg.addLowLevelNode({
      id: 'src/index.ts',
      feature: { description: 'entry point' },
      metadata: { entityType: 'file', path: 'src/index.ts' },
    })
    await rpg.addLowLevelNode({
      id: 'src/index.ts:function:run:1',
      feature: { description: 'main runner' },
      metadata: {
        entityType: 'function',
        path: 'src/index.ts',
        qualifiedName: 'run',
      },
    })

    // index.ts imports util.ts; run() calls Calculator.add
    await rpg.addDependencyEdge({
      source: 'src/index.ts',
      target: 'src/util.ts',
      dependencyType: 'import',
      symbol: 'Calculator',
      line: 1,
    })
    await rpg.addDependencyEdge({
      source: 'src/index.ts:function:run:1',
      target: 'src/util.ts:method:Calculator.add:5',
      dependencyType: 'call',
      symbol: 'add',
      line: 3,
    })

    return rpg
  }

  it('emits the vendor schema with required top-level fields', async () => {
    const rpg = await buildRpg()
    const result = await toVendorDepGraph(rpg, {
      repoDir: '/tmp/sample',
      repoName: 'sample-repo',
    })
    expect(result.repo_name).toBe('sample-repo')
    expect(result.repo_dir).toBe('/tmp/sample')
    expect(result.root).toBe('.')
    expect(result.nodes).toBeTypeOf('object')
    expect(Array.isArray(result.edges)).toBe(true)
    expect(result._dep_to_rpg_map).toBeTypeOf('object')
  })

  it('creates directory, file, class, function, and method nodes', async () => {
    const rpg = await buildRpg()
    const { nodes } = await toVendorDepGraph(rpg, {
      repoDir: '/tmp/sample',
      repoName: 'sample-repo',
    })
    expect(nodes['.']?.type).toBe('directory')
    expect(nodes.src?.type).toBe('directory')
    expect(nodes['src/util.ts']?.type).toBe('file')
    expect(nodes['src/util.ts:Calculator']?.type).toBe('class')
    expect(nodes['src/util.ts:Calculator:add']?.type).toBe('method')
    expect(nodes['src/index.ts:run']?.type).toBe('function')
  })

  it('synthesizes a contains chain from . → src → file → class → method', async () => {
    const rpg = await buildRpg()
    const { edges } = await toVendorDepGraph(rpg, {
      repoDir: '/tmp/sample',
      repoName: 'sample-repo',
    })
    const contains = edges.filter(e => e.attrs.type === 'contains')
    const has = (src: string, dst: string): boolean =>
      contains.some(e => e.src === src && e.dst === dst)

    expect(has('.', 'src')).toBe(true)
    expect(has('src', 'src/util.ts')).toBe(true)
    expect(has('src/util.ts', 'src/util.ts:Calculator')).toBe(true)
    expect(has('src/util.ts:Calculator', 'src/util.ts:Calculator:add')).toBe(true)
    expect(has('src/index.ts', 'src/index.ts:run')).toBe(true)
  })

  it('translates dependency edges to imports/invokes attrs', async () => {
    const rpg = await buildRpg()
    const { edges } = await toVendorDepGraph(rpg, {
      repoDir: '/tmp/sample',
      repoName: 'sample-repo',
    })
    const semantic = edges.filter(e => e.attrs.type !== 'contains')
    const imports = semantic.find(e => e.attrs.type === 'imports')
    const invokes = semantic.find(e => e.attrs.type === 'invokes')
    expect(imports).toBeDefined()
    expect(imports?.src).toBe('src/index.ts')
    expect(imports?.dst).toBe('src/util.ts')
    expect(invokes).toBeDefined()
    expect(invokes?.src).toBe('src/index.ts:run')
    expect(invokes?.dst).toBe('src/util.ts:Calculator:add')
  })

  it('uses cumulative directory IDs for nested contains chains', async () => {
    // Regression for the bug where the chain `. → a → a/b → a/b/c` was
    // emitted as `. → a → b → c`, referencing non-existent node IDs.
    const rpg = await RepositoryPlanningGraph.create({ name: 'nested-repo' })
    await rpg.addLowLevelNode({
      id: 'deep/nested/path/x.ts',
      feature: { description: 'deep file' },
      metadata: { entityType: 'file', path: 'deep/nested/path/x.ts' },
    })

    const { nodes, edges } = await toVendorDepGraph(rpg, {
      repoDir: '/tmp/sample',
      repoName: 'nested-repo',
    })

    // Every cumulative directory ID must exist as a node.
    expect(nodes.deep?.type).toBe('directory')
    expect(nodes['deep/nested']?.type).toBe('directory')
    expect(nodes['deep/nested/path']?.type).toBe('directory')

    // And every contains edge must reference a real node (no orphan IDs
    // like a bare 'nested' or 'path' that bypassed the cumulative join).
    const contains = edges.filter(e => e.attrs.type === 'contains')
    for (const e of contains) {
      expect(nodes[e.src]).toBeDefined()
      expect(nodes[e.dst]).toBeDefined()
    }

    const has = (src: string, dst: string): boolean =>
      contains.some(e => e.src === src && e.dst === dst)
    expect(has('.', 'deep')).toBe(true)
    expect(has('deep', 'deep/nested')).toBe(true)
    expect(has('deep/nested', 'deep/nested/path')).toBe(true)
    expect(has('deep/nested/path', 'deep/nested/path/x.ts')).toBe(true)
  })

  it('populates _dep_to_rpg_map for every entity node', async () => {
    const rpg = await buildRpg()
    const { _dep_to_rpg_map: map } = await toVendorDepGraph(rpg, {
      repoDir: '/tmp/sample',
      repoName: 'sample-repo',
    })
    expect(map['src/util.ts']).toEqual(['src/util.ts'])
    expect(map['src/util.ts:Calculator']).toEqual([
      'src/util.ts:class:Calculator:1',
    ])
    expect(map['src/util.ts:Calculator:add']).toEqual([
      'src/util.ts:method:Calculator.add:5',
    ])
  })
})
