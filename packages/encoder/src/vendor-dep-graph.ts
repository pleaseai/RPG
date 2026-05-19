import type { RepositoryPlanningGraph } from '@pleaseai/soop-graph'
import type { LowLevelNode, Node } from '@pleaseai/soop-graph/node'
import path from 'node:path'
import { isLowLevelNode } from '@pleaseai/soop-graph/node'

/** Normalize a path to use forward-slash separators on all platforms. */
function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

/**
 * Vendor-schema dependency-graph emitter.
 *
 * Ports the shape produced by RPG-Kit
 * `vendor/RPG-ZeroRepo/RPG-Kit/scripts/rpg/dep_graph.py::DependencyGraph.to_dict()`
 * (and the side-car file written by `scripts/rpg_encoder/run_encode.py`).
 *
 * The schema is consumed by `rpg_visualize.py` and is the structure we
 * mirror in `@pleaseai/soop-visualize`. We build it directly from the RPG
 * (which already contains the resolved file/class/function/method nodes
 * plus dependency edges) rather than from any transient analyzer state.
 */

export type VendorNodeType = 'directory' | 'file' | 'class' | 'function' | 'method'

export type VendorEdgeType = 'contains' | 'imports' | 'invokes' | 'inherits'

export interface VendorDepNode {
  type: VendorNodeType
  module: string
  name: string
  rpg_nodes: string[]
}

export interface VendorDepEdge {
  src: string
  dst: string
  attrs: {
    type: VendorEdgeType
    line?: number
    symbol?: string
    targetSymbol?: string
  }
}

export interface VendorDepGraph {
  repo_dir: string
  repo_name: string
  root: string
  nodes: Record<string, VendorDepNode>
  edges: VendorDepEdge[]
  _dep_to_rpg_map: Record<string, string[]>
}

export interface ToVendorDepGraphOptions {
  repoDir: string
  repoName: string
  /** Root identifier for the top-level directory. Defaults to ".". */
  root?: string
}

/**
 * Convert a relative file path to a dotted module path, matching the
 * vendor's `path_to_module()` (RPG-Kit `dep_graph.py:134-154`).
 *
 * - `.` → `""`
 * - `pkg/mod.py` → `"pkg.mod"`
 * - `pkg/__init__.py` → `"pkg"`
 * - `src/foo.ts` → `"src.foo"`
 */
export function pathToModule(nodeId: string): string {
  let s = toPosix(nodeId.trim())
  if (s.includes(':')) {
    s = s.split(':', 1)[0] ?? s
  }
  if (s.startsWith('./'))
    s = s.slice(2)
  if (s === '.' || s === '')
    return ''

  const lastSlash = s.lastIndexOf('/')
  const dir = lastSlash >= 0 ? s.slice(0, lastSlash) : ''
  const base = lastSlash >= 0 ? s.slice(lastSlash + 1) : s
  const dotIdx = base.lastIndexOf('.')

  // Files with an extension we treat like modules; drop the extension.
  if (dotIdx > 0) {
    const stem = base.slice(0, dotIdx)
    if (stem === '__init__') {
      return dir.replaceAll('/', '.')
    }
    const stripped = dir ? `${dir}/${stem}` : stem
    return stripped.replaceAll('/', '.')
  }

  // Directory or extension-less file
  return s.replaceAll('/', '.')
}

/** Strip the extension from a base filename (used for FILE node `name`). */
function basenameNoExt(filePath: string): string {
  const last = filePath.split('/').at(-1) ?? filePath
  const dot = last.lastIndexOf('.')
  return dot > 0 ? last.slice(0, dot) : last
}

/**
 * Compute the vendor dep-graph node ID for a low-level RPG node.
 *
 * Conventions (match RPG-Kit `dep_graph.py` `_add_node()`):
 *   file:     `path/to/file.ts`
 *   class:    `path/to/file.ts:ClassName`
 *   function: `path/to/file.ts:functionName`
 *   method:   `path/to/file.ts:ClassName:methodName`
 */
function depNodeIdFor(node: LowLevelNode): string | null {
  const path = node.metadata?.path
  if (!path)
    return null

  const entityType = node.metadata?.entityType
  const qualified = node.metadata?.qualifiedName
  switch (entityType) {
    case 'file':
      return path
    case 'class':
    case 'function':
      // qualified name is preferred when available (e.g. "Foo" or "ns.Foo")
      return `${path}:${qualified ?? deriveSimpleName(node)}`
    case 'method': {
      // qualifiedName commonly looks like "ClassName.methodName".
      if (qualified && qualified.includes('.')) {
        const [cls, ...rest] = qualified.split('.')
        return `${path}:${cls}:${rest.join('.')}`
      }
      return `${path}:${qualified ?? deriveSimpleName(node)}`
    }
    default:
      return null
  }
}

function deriveSimpleName(node: Node): string {
  // Fall back to deriving from the node ID: pkg/file.ts:class:Foo:10 → "Foo"
  const colonParts = node.id.split(':')
  if (colonParts.length >= 3)
    return colonParts[2] ?? node.id
  const slashParts = node.id.split('/')
  return slashParts.at(-1) ?? node.id
}

function isVendorEntity(node: Node): node is LowLevelNode {
  if (!isLowLevelNode(node))
    return false
  const entityType = node.metadata?.entityType
  return entityType === 'file'
    || entityType === 'class'
    || entityType === 'function'
    || entityType === 'method'
}

/** Map a `DependencyEdge.dependencyType` to the vendor edge `attrs.type`. */
function mapDependencyEdgeType(depType: string): VendorEdgeType | null {
  switch (depType) {
    case 'import':
      return 'imports'
    case 'call':
    case 'use':
      return 'invokes'
    case 'inherit':
    case 'implement':
      return 'inherits'
    default:
      return null
  }
}

/**
 * Synthesize directory nodes + CONTAINS edges for every file's parent path,
 * up to the repo root (`.`). Mutates `nodes` and `edges`.
 */
function addDirectoryAncestors(
  filePath: string,
  fileDepId: string,
  root: string,
  nodes: Record<string, VendorDepNode>,
  edges: VendorDepEdge[],
  seenContains: Set<string>,
): void {
  const parts = toPosix(filePath).split('/').filter(Boolean)

  // Build cumulative directory IDs (e.g. ['a', 'a/b', 'a/b/c']) — the
  // CONTAINS chain must use these full IDs, not bare segment names, so
  // every edge endpoint references a node that actually exists.
  const dirIds: string[] = []
  for (let i = 0; i < parts.length - 1; i++) {
    const dirId = dirIds.length > 0 ? `${dirIds.at(-1)}/${parts[i]!}` : parts[i]!
    dirIds.push(dirId)
    if (!nodes[dirId]) {
      nodes[dirId] = {
        type: 'directory',
        module: pathToModule(dirId),
        name: parts[i]!,
        rpg_nodes: [],
      }
    }
  }

  // Containment chain: root → top dir → … → parent dir → file
  let prev = root
  for (const dirId of dirIds) {
    const containKey = `${prev}→${dirId}`
    if (!seenContains.has(containKey)) {
      edges.push({ src: prev, dst: dirId, attrs: { type: 'contains' } })
      seenContains.add(containKey)
    }
    prev = dirId
  }
  const parent = dirIds.length > 0 ? dirIds.at(-1)! : root
  const finalKey = `${parent}→${fileDepId}`
  if (!seenContains.has(finalKey)) {
    edges.push({ src: parent, dst: fileDepId, attrs: { type: 'contains' } })
    seenContains.add(finalKey)
  }
}

/**
 * Convert an RPG into the vendor `dep_graph.json` schema. Pure function:
 * does not mutate the input RPG.
 */
export async function toVendorDepGraph(
  rpg: RepositoryPlanningGraph,
  options: ToVendorDepGraphOptions,
): Promise<VendorDepGraph> {
  const root = options.root ?? '.'

  const nodes: Record<string, VendorDepNode> = {
    [root]: { type: 'directory', module: '', name: root, rpg_nodes: [] },
  }
  const edges: VendorDepEdge[] = []
  const depToRpg: Record<string, string[]> = {}
  const seenContains = new Set<string>()

  // ---- Stage 1: build file/class/function/method nodes
  const allNodes = await rpg.getNodes()

  // file path → dep node ID, used when resolving class/function/method parents
  const fileIdByPath = new Map<string, string>()
  // RPG node id → dep node id, used to translate dependency edges
  const rpgIdToDepId = new Map<string, string>()
  // path → entity-name → method's class parent (for METHOD)
  interface ClassEntry { depId: string, rpgId: string }
  const classByPathAndName = new Map<string, Map<string, ClassEntry>>()

  // First pass: register FILE nodes so methods/classes/functions can find their parent.
  for (const node of allNodes) {
    if (!isVendorEntity(node))
      continue
    if (node.metadata?.entityType !== 'file')
      continue
    const path = node.metadata.path!
    const depId = path
    nodes[depId] = {
      type: 'file',
      module: pathToModule(path),
      name: basenameNoExt(path),
      rpg_nodes: [node.id],
    }
    fileIdByPath.set(path, depId)
    rpgIdToDepId.set(node.id, depId)
    depToRpg[depId] = [node.id]
    addDirectoryAncestors(path, depId, root, nodes, edges, seenContains)
  }

  // Second pass: class nodes (needed for method parent resolution).
  for (const node of allNodes) {
    if (!isVendorEntity(node))
      continue
    if (node.metadata?.entityType !== 'class')
      continue
    const path = node.metadata.path
    if (!path)
      continue
    const depId = depNodeIdFor(node)
    if (!depId)
      continue
    const name = depId.split(':').at(-1)!
    nodes[depId] = {
      type: 'class',
      module: pathToModule(path),
      name,
      rpg_nodes: [node.id],
    }
    rpgIdToDepId.set(node.id, depId)
    depToRpg[depId] = [node.id]
    const fileId = fileIdByPath.get(path) ?? path
    const key = `${fileId}→${depId}`
    if (!seenContains.has(key)) {
      edges.push({ src: fileId, dst: depId, attrs: { type: 'contains' } })
      seenContains.add(key)
    }
    let classMap = classByPathAndName.get(path)
    if (!classMap) {
      classMap = new Map()
      classByPathAndName.set(path, classMap)
    }
    classMap.set(name, { depId, rpgId: node.id })
  }

  // Third pass: function + method nodes.
  for (const node of allNodes) {
    if (!isVendorEntity(node))
      continue
    const entityType = node.metadata?.entityType
    if (entityType !== 'function' && entityType !== 'method')
      continue
    const path = node.metadata?.path
    if (!path)
      continue
    const depId = depNodeIdFor(node)
    if (!depId)
      continue

    let parentId = fileIdByPath.get(path) ?? path
    if (entityType === 'method') {
      const parts = depId.split(':')
      if (parts.length >= 3) {
        const cls = parts[1]!
        const classEntry = classByPathAndName.get(path)?.get(cls)
        if (classEntry)
          parentId = classEntry.depId
      }
    }

    nodes[depId] = {
      type: entityType,
      module: pathToModule(path),
      name: depId.split(':').at(-1)!,
      rpg_nodes: [node.id],
    }
    rpgIdToDepId.set(node.id, depId)
    depToRpg[depId] = [node.id]
    const key = `${parentId}→${depId}`
    if (!seenContains.has(key)) {
      edges.push({ src: parentId, dst: depId, attrs: { type: 'contains' } })
      seenContains.add(key)
    }
  }

  // ---- Stage 2: translate RPG dependency edges → vendor edges.
  const depEdges = await rpg.getDependencyEdges()
  for (const edge of depEdges) {
    const attrType = mapDependencyEdgeType(edge.dependencyType)
    if (!attrType)
      continue
    const src = rpgIdToDepId.get(edge.source)
    const dst = rpgIdToDepId.get(edge.target)
    if (!src || !dst)
      continue
    edges.push({
      src,
      dst,
      attrs: {
        type: attrType,
        ...(edge.line !== undefined ? { line: edge.line } : {}),
        ...(edge.symbol ? { symbol: edge.symbol } : {}),
        ...(edge.targetSymbol ? { targetSymbol: edge.targetSymbol } : {}),
      },
    })
  }

  return {
    repo_dir: options.repoDir,
    repo_name: options.repoName,
    root,
    nodes,
    edges,
    _dep_to_rpg_map: depToRpg,
  }
}
