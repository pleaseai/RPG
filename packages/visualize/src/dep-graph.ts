import type { RawFeatEdge, RpgData } from './types'

export interface SemanticEdge extends RawFeatEdge {
  // No additional fields — kept as a named type for clarity.
}

export interface DepGraphView {
  nodes: Array<{
    id: string
    name: string
    type: string
    module: string
    rpg_nodes: string[]
    depth: number
  }>
  edges: Array<{ source: string, target: string, type: string }>
  parent_map: Record<string, string>
  stats: Record<string, number>
}

export interface DepTreeNode {
  id: string
  name: string
  type: string
  rpg_nodes: string[]
  children: DepTreeNode[]
}

const CONTAINS_RELATIONS = new Set(['contains', 'CONTAINS', 'composes', 'COMPOSES'])

/**
 * Extract non-containment edges from the feature graph. Mirrors
 * `rpg_visualize.py::get_semantic_edges()` (lines 103-109).
 */
export function getSemanticEdges(data: RpgData): SemanticEdge[] {
  return (data.edges ?? []).filter(e => !CONTAINS_RELATIONS.has(e.relation ?? ''))
}

/**
 * Extract dep_graph nodes, hierarchy, and semantic edges for D3 rendering.
 * Ported from `rpg_visualize.py::extract_dep_graph()` (lines 119-193).
 */
export function extractDepGraph(data: RpgData): DepGraphView {
  const dg = data.dep_graph
  if (!dg) {
    return { nodes: [], edges: [], parent_map: {}, stats: {} }
  }
  const rawNodes = dg.nodes ?? {}
  const rawEdges = dg.edges ?? []

  // Build parent map from CONTAINS edges
  const parentMap: Record<string, string> = {}
  for (const e of rawEdges) {
    const etype = e.attrs?.type ?? ''
    if (CONTAINS_RELATIONS.has(etype))
      parentMap[e.dst] = e.src
  }

  // Semantic edges (non-containment) only
  const edges: DepGraphView['edges'] = []
  const stats: Record<string, number> = {}
  for (const e of rawEdges) {
    const etype = e.attrs?.type ?? ''
    if (CONTAINS_RELATIONS.has(etype))
      continue
    edges.push({ source: e.src, target: e.dst, type: etype })
    stats[etype] = (stats[etype] ?? 0) + 1
  }

  const connected = new Set<string>()
  for (const e of edges) {
    connected.add(e.source)
    connected.add(e.target)
  }

  // Add all ancestors so the hierarchy is complete
  const relevant = new Set<string>(connected)
  for (const nid of connected) {
    let cur = nid
    while (parentMap[cur]) {
      cur = parentMap[cur]!
      relevant.add(cur)
    }
  }

  const depthOf = (nid: string): number => {
    let d = 0
    let cur = nid
    while (parentMap[cur]) {
      cur = parentMap[cur]!
      d += 1
    }
    return d
  }

  const nodes: DepGraphView['nodes'] = []
  for (const [nid, attrs] of Object.entries(rawNodes)) {
    if (!relevant.has(nid))
      continue
    nodes.push({
      id: nid,
      name: typeof attrs.name === 'string'
        ? attrs.name
        : nid.split('/').at(-1)!.split(':').at(-1)!,
      type: typeof attrs.type === 'string' ? attrs.type : 'unknown',
      module: typeof attrs.module === 'string' ? attrs.module : '',
      rpg_nodes: Array.isArray(attrs.rpg_nodes) ? attrs.rpg_nodes : [],
      depth: depthOf(nid),
    })
  }

  const filteredParent: Record<string, string> = {}
  for (const [k, v] of Object.entries(parentMap)) {
    if (relevant.has(k) && relevant.has(v))
      filteredParent[k] = v
  }

  return { nodes, edges, parent_map: filteredParent, stats }
}

/**
 * Build a tree of the *complete* dep_graph (not just connected nodes) for
 * the Mapping tab. Ported from `rpg_visualize.py::build_dep_tree()`
 * (lines 196-227).
 */
export function buildDepTree(data: RpgData): DepTreeNode {
  const dg = data.dep_graph
  if (!dg) {
    return { id: '.', name: '.', type: 'directory', rpg_nodes: [], children: [] }
  }
  const rawNodes = dg.nodes ?? {}
  const rawEdges = dg.edges ?? []

  const parentMap: Record<string, string> = {}
  const childrenMap = new Map<string, string[]>()
  for (const e of rawEdges) {
    if (CONTAINS_RELATIONS.has(e.attrs?.type ?? '')) {
      parentMap[e.dst] = e.src
      const arr = childrenMap.get(e.src) ?? []
      arr.push(e.dst)
      childrenMap.set(e.src, arr)
    }
  }

  const roots = Object.keys(rawNodes).filter(nid => !parentMap[nid])

  const toTree = (nid: string): DepTreeNode => {
    const attrs = rawNodes[nid] ?? {}
    const children = (childrenMap.get(nid) ?? []).toSorted().map(toTree)
    return {
      id: nid,
      name: typeof attrs.name === 'string'
        ? attrs.name
        : nid.split('/').at(-1)!.split(':').at(-1)!,
      type: typeof attrs.type === 'string' ? attrs.type : 'unknown',
      rpg_nodes: Array.isArray(attrs.rpg_nodes) ? attrs.rpg_nodes : [],
      children,
    }
  }

  if (roots.length === 1)
    return toTree(roots[0]!)

  return {
    id: '__dep_root__',
    name: 'repo',
    type: 'directory',
    rpg_nodes: [],
    children: roots.toSorted().map(toTree),
  }
}
