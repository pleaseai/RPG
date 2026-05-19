import type { RawFeatNode, RpgData } from './types'

/** A D3-ready feature tree node (children always materialized). */
export interface FeatTreeNode extends Omit<RawFeatNode, 'children'> {
  children: FeatTreeNode[]
}

/**
 * Normalize both the tree (`{ root: {...} }`) and flat
 * (`{ nodes: [], edges: [] }`) RPG variants into a unified tree dict
 * suitable for D3.
 *
 * Ported from `rpg_visualize.py::normalize_to_tree()` (lines 67-100).
 */
export function normalizeToTree(data: RpgData): FeatTreeNode {
  if (
    data.root
    && typeof data.root === 'object'
    && !Array.isArray(data.root)
  ) {
    return materialize(data.root as RawFeatNode)
  }

  const nodes = data.nodes ?? []
  const byId = new Map<string, RawFeatNode>()
  for (const n of nodes) byId.set(n.id, n)

  const childrenMap = new Map<string, string[]>()
  for (const n of nodes) childrenMap.set(n.id, [])

  const childSet = new Set<string>()
  for (const e of data.edges ?? []) {
    const rel = (e.relation ?? '').toLowerCase()
    if (rel === 'contains' || rel === 'composes') {
      const arr = childrenMap.get(e.src)
      if (arr) {
        arr.push(e.dst)
        childSet.add(e.dst)
      }
    }
  }

  const roots = [...byId.keys()].filter(id => !childSet.has(id))

  const toTree = (id: string): FeatTreeNode => {
    const node = byId.get(id) ?? { id }
    return {
      ...node,
      children: (childrenMap.get(id) ?? []).map(toTree),
    }
  }

  if (roots.length === 1)
    return toTree(roots[0]!)

  return {
    id: '__root__',
    name: data.repo_name ?? 'root',
    node_type: 'repository',
    level: 0,
    meta: { type_name: 'root', path: '.', description: '' },
    children: roots.map(toTree),
  }
}

/** Materialize raw children into a proper FeatTreeNode tree. */
function materialize(raw: RawFeatNode): FeatTreeNode {
  return {
    ...raw,
    children: (raw.children ?? []).map(materialize),
  }
}

/** Recursive node count for a feature tree (matches `count_nodes()`). */
export function countNodes(node: FeatTreeNode): number {
  let c = 1
  for (const child of node.children)
    c += countNodes(child)
  return c
}
