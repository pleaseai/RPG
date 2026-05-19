import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildDepTree,
  countNodes,
  extractDepGraph,
  generateHtml,
  getSemanticEdges,
  loadRpg,
  normalizeToTree,
  resolveDepGraphPath,
} from '@pleaseai/soop-visualize'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')

describe('loadRpg', () => {
  it('merges sidecar dep_graph.json via dep_graph_file reference', async () => {
    const data = await loadRpg(path.join(FIXTURE_DIR, 'sample-rpg.json'))
    expect(data.repo_name).toBe('sample-repo')
    expect(data.dep_graph).toBeTruthy()
    const nodes = (data.dep_graph?.nodes ?? {}) as Record<string, unknown>
    expect(Object.keys(nodes)).toContain('src/util.ts')
  })

  it('resolves dep_graph from explicit path', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'soop-viz-'))
    try {
      const sidecar = path.join(tmp, 'dep_graph.json')
      const rpgPath = path.join(tmp, 'rpg.json')
      await Promise.all([
        readFile(path.join(FIXTURE_DIR, 'dep_graph.json'), 'utf-8').then(t =>
          import('node:fs/promises').then(fs => fs.writeFile(sidecar, t)),
        ),
        readFile(path.join(FIXTURE_DIR, 'sample-rpg.json'), 'utf-8').then(t =>
          import('node:fs/promises').then(fs => fs.writeFile(rpgPath, t)),
        ),
      ])
      const data = { dep_graph_file: 'dep_graph.json' }
      const resolved = await resolveDepGraphPath(rpgPath, data)
      expect(resolved).toBe(sidecar)
    }
    finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })
})

describe('normalizeToTree + countNodes', () => {
  it('reconstructs hierarchy from flat nodes+composes edges', async () => {
    const data = await loadRpg(path.join(FIXTURE_DIR, 'sample-rpg.json'))
    const tree = normalizeToTree(data)
    // Root → src → util.ts → helper = 4 nodes
    expect(countNodes(tree)).toBe(4)
    // Children should be present
    expect(tree.children.length).toBe(1) // src
    expect(tree.children[0]!.children.length).toBe(1) // util.ts
  })
})

describe('extractDepGraph + buildDepTree', () => {
  it('keeps only nodes connected via semantic edges + their ancestors', async () => {
    const data = await loadRpg(path.join(FIXTURE_DIR, 'sample-rpg.json'))
    const dep = extractDepGraph(data)
    // semantic edges: imports + invokes = 2
    expect(dep.edges).toHaveLength(2)
    expect(dep.stats).toEqual({ imports: 1, invokes: 1 })
    // node IDs present (connected = src/util.ts, src/util.ts:helper, src/index.ts; ancestors add src + .)
    const nodeIds = new Set(dep.nodes.map(n => n.id))
    expect(nodeIds.has('src/util.ts')).toBe(true)
    expect(nodeIds.has('src/util.ts:helper')).toBe(true)
    expect(nodeIds.has('src/index.ts')).toBe(true)
    expect(nodeIds.has('src')).toBe(true)
    expect(nodeIds.has('.')).toBe(true)
  })

  it('produces a full tree (including disconnected nodes) for the mapping view', async () => {
    const data = await loadRpg(path.join(FIXTURE_DIR, 'sample-rpg.json'))
    const tree = buildDepTree(data)
    expect(tree.id).toBe('.')
    expect(tree.children.length).toBeGreaterThan(0)
  })

  it('returns empty view when no dep_graph is present', async () => {
    const dep = extractDepGraph({ repo_name: 'empty' })
    expect(dep.nodes).toHaveLength(0)
    expect(dep.edges).toHaveLength(0)
  })
})

describe('getSemanticEdges', () => {
  it('filters out contains/composes relations', async () => {
    const data = await loadRpg(path.join(FIXTURE_DIR, 'sample-rpg.json'))
    const semantic = getSemanticEdges(data)
    // Fixture has only composes edges → expect zero
    expect(semantic).toHaveLength(0)
  })
})

describe('generateHtml', () => {
  let html: string

  beforeAll(async () => {
    const data = await loadRpg(path.join(FIXTURE_DIR, 'sample-rpg.json'))
    html = await generateHtml(data)
  })

  afterAll(() => {
    html = ''
  })

  it('emits a complete HTML document with all 3 tab labels', () => {
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('Feat Graph')
    expect(html).toContain('Dep Graph')
    expect(html).toContain('Mapping')
  })

  it('substitutes the repo name into the title and header', () => {
    expect(html).toContain('<title>RPG: sample-repo</title>')
    expect(html).toContain('RPG: sample-repo')
  })

  it('inlines the feature tree as JSON', () => {
    expect(html).toContain('const treeData = ')
    // The fixture's util.ts node should appear in the inlined JSON
    expect(html).toMatch(/"src\/util\.ts"/)
  })

  it('inlines dep_graph nodes/edges as JSON', () => {
    expect(html).toContain('const depNodesRaw = ')
    expect(html).toContain('const depEdgesRaw = ')
    // The dep_graph has an imports edge from src/index.ts → src/util.ts
    expect(html).toMatch(/"type":"imports"/)
  })

  it('reflects feature node count in stats', () => {
    // Fixture has 4 RPG nodes
    expect(html).toContain('<b>4</b>')
  })

  it('reflects dep edge stats summary (imports, invokes)', () => {
    // dep_edge_summary aggregates {imports: 1, invokes: 1}
    expect(html).toContain('imports: 1')
    expect(html).toContain('invokes: 1')
  })

  it('sets hasDep/hasMap booleans correctly for non-empty fixture', () => {
    expect(html).toContain('const hasDep = true')
    expect(html).toContain('const hasMap = true')
  })

  it('contains no unresolved __PLACEHOLDER__ tokens', () => {
    expect(html).not.toMatch(/__[A-Z_]+__/)
  })
})

describe('generateHtml — XSS / script-context safety', () => {
  it('escapes </script> sequences inside inlined JSON blobs', async () => {
    const malicious = {
      repo_name: 'evil',
      repo_info: '',
      data_flow: [],
      excluded_files: [],
      repo_node_id: 'r',
      nodes: [
        {
          id: 'r',
          name: 'r',
          node_type: 'repo',
          level: 0,
          meta: { type_name: 'repo', path: '.', description: 'Root', content: '' },
        },
        {
          id: 'malicious',
          // Realistic shape: a feature description picked up from a code
          // comment that legitimately mentions an HTML snippet.
          name: '</script><img src=x onerror=alert(1)>',
          node_type: 'feature',
          level: 2,
          meta: {
            type_name: 'file',
            path: 'src/evil.ts',
            description: '</script>',
            content: '',
          },
        },
      ],
      edges: [{ src: 'r', dst: 'malicious', relation: 'composes', meta: null }],
      _dep_to_rpg_map: {},
      dep_graph: null,
    }
    const html = await generateHtml(malicious)
    // The verbatim sequence "</script>" must NOT appear inside the inlined
    // JSON. JSON.stringify alone would leave it intact and break the
    // script block; jsonForScript() encodes "<" as "<".
    const treeIdx = html.indexOf('const treeData =')
    const trailingScriptClose = html.indexOf('</script>', treeIdx)
    // The only </script> in the document must be after all the data
    // initialization (i.e. the real closing tag of the inline script).
    const dataBlockEnd = html.indexOf('const hasMap =', treeIdx)
    expect(trailingScriptClose).toBeGreaterThan(dataBlockEnd)
    // And the dangerous payload must be encoded, not literal. Escaping `<`
    // alone is sufficient — the HTML parser only recognizes `</script>` as
    // an end-tag when it sees the literal `<` character.
    expect(html).not.toContain('</script><img src=x')
    expect(html).toContain('\\u003c/script>')
  })

  it('escapes U+2028 / U+2029 line terminators inside inlined JSON', async () => {
    const data = {
      repo_name: 'lineterm',
      nodes: [
        {
          id: 'r',
          name: 'r',
          node_type: 'repo',
          level: 0,
          meta: { type_name: 'repo', path: '.', description: '', content: '' },
        },
        {
          id: 'x',
          name: `line1${String.fromCodePoint(0x2028)}line2${String.fromCodePoint(0x2029)}line3`,
          node_type: 'feature',
          level: 1,
          meta: { type_name: 'file', path: 'x', description: '', content: '' },
        },
      ],
      edges: [],
      _dep_to_rpg_map: {},
      dep_graph: null,
    }
    const html = await generateHtml(data)
    // The raw line-terminator codepoints must not survive into the
    // inlined JSON (they would split the JS parse) — they should be
    // encoded as the literal six-char sequences  / .
    expect(html).not.toContain(String.fromCodePoint(0x2028))
    expect(html).not.toContain(String.fromCodePoint(0x2029))
    expect(html).toContain('\\u2028')
    expect(html).toContain('\\u2029')
  })
})

describe('resolveDepGraphPath — path traversal containment', () => {
  it('refuses dep_graph_file values that escape the rpg directory', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'soop-viz-trav-'))
    try {
      const rpgPath = path.join(tmp, 'rpg.json')
      const { writeFile } = await import('node:fs/promises')
      await writeFile(rpgPath, '{"repo_name":"x"}')
      // Try to escape upward — must NOT be resolved.
      const escaped = await resolveDepGraphPath(rpgPath, {
        dep_graph_file: '../../../etc/passwd',
      })
      expect(escaped).toBeNull()
      // A traversal that happens to land back inside the dir should also
      // not match unless the file actually exists there.
      const samePath = await resolveDepGraphPath(rpgPath, {
        dep_graph_file: './nonexistent.json',
      })
      expect(samePath).toBeNull()
    }
    finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  it('refuses dep_graph_file values whose canonical path symlinks outside rpgDir', async () => {
    const inside = await mkdtemp(path.join(tmpdir(), 'soop-viz-sym-in-'))
    const outside = await mkdtemp(path.join(tmpdir(), 'soop-viz-sym-out-'))
    try {
      const { symlink, writeFile } = await import('node:fs/promises')
      // Plant the secret outside the rpg dir.
      const secret = path.join(outside, 'secret.json')
      await writeFile(secret, '{"leaked": true}')
      // And drop a symlink inside the rpg dir that *points* there.
      await symlink(secret, path.join(inside, 'evil.json'))
      const rpgPath = path.join(inside, 'rpg.json')
      await writeFile(rpgPath, '{"repo_name":"x"}')

      const escaped = await resolveDepGraphPath(rpgPath, {
        dep_graph_file: 'evil.json',
      })
      expect(escaped).toBeNull()
    }
    finally {
      await rm(inside, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})
