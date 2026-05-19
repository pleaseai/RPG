import type { Edge, FunctionalEdge } from './edge'
import type { Node } from './node'
import { z } from 'zod/v4'
import {
  createDataFlowEdge,
  createDependencyEdge,
  createFunctionalEdge,
  isDataFlowEdge,
  isDependencyEdge,
  isFunctionalEdge,
} from './edge'
import { createHighLevelNode, createLowLevelNode, isHighLevelNode } from './node'

// ==================== Python-compatible Schemas ====================

export const PythonNodeMetaSchema = z.object({
  type_name: z.string().nullable(),
  path: z.union([z.string(), z.array(z.string())]).nullable(),
  description: z.string(),
  content: z.string(),
})

export type PythonNodeMeta = z.infer<typeof PythonNodeMetaSchema>

export const PythonNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  node_type: z.string().nullable(),
  level: z.number().nullable(),
  meta: PythonNodeMetaSchema.nullable(),
})

export type PythonNode = z.infer<typeof PythonNodeSchema>

export const PythonEdgeMetaSchema = z.object({
  type_name: z.string().nullable(),
  path: z.string().nullable(),
  description: z.string(),
  content: z.string(),
})

export type PythonEdgeMeta = z.infer<typeof PythonEdgeMetaSchema>

export const PythonEdgeSchema = z.object({
  src: z.string(),
  dst: z.string(),
  relation: z.string(),
  meta: PythonEdgeMetaSchema.nullable(),
})

export type PythonEdge = z.infer<typeof PythonEdgeSchema>

export const PythonRPGSchema = z.object({
  repo_name: z.string(),
  repo_info: z.string(),
  data_flow: z.array(z.unknown()),
  excluded_files: z.array(z.string()),
  repo_node_id: z.string().nullable(),
  nodes: z.array(PythonNodeSchema),
  edges: z.array(PythonEdgeSchema),
  _dep_to_rpg_map: z.record(z.string(), z.array(z.string())),
  dep_graph: z.unknown().nullable(),
  // Path (relative to the rpg.json directory) of a sidecar dep_graph.json
  // file. Matches RPG-Kit `run_encode.py`'s `_dep_graph_file` convention.
  dep_graph_file: z.string().nullable().optional(),
})

export type PythonRPG = z.infer<typeof PythonRPGSchema>

// ==================== Level / NodeType Constants ====================

const MAX_LEVEL = 5

const LEVEL_TO_NODE_TYPE: Record<number, string> = {
  0: 'repo',
  1: 'functional_area',
  2: 'category',
  3: 'subcategory',
  4: 'feature_group',
  5: 'feature',
}

export function levelToNodeType(level: number): string {
  return LEVEL_TO_NODE_TYPE[Math.min(level, MAX_LEVEL)] ?? 'feature'
}

// ==================== Node Level Computation ====================

export function computeNodeLevels(
  nodeIds: string[],
  functionalEdges: FunctionalEdge[],
): Map<string, number> {
  const levels = new Map<string, number>()
  const childrenMap = new Map<string, string[]>()
  const parentSet = new Set<string>()

  for (const id of nodeIds) {
    childrenMap.set(id, [])
  }

  for (const edge of functionalEdges) {
    childrenMap.get(edge.source)?.push(edge.target)
    parentSet.add(edge.target)
  }

  // Roots: nodes that have no incoming functional edges
  const roots = nodeIds.filter(id => !parentSet.has(id))

  // BFS from roots
  const queue: Array<{ id: string, level: number }> = roots.map(id => ({ id, level: 0 }))
  const visited = new Set<string>()

  while (queue.length > 0) {
    const { id, level } = queue.shift()!
    if (visited.has(id))
      continue
    visited.add(id)
    levels.set(id, Math.min(level, MAX_LEVEL))

    for (const child of childrenMap.get(id) ?? []) {
      if (!visited.has(child)) {
        queue.push({ id: child, level: level + 1 })
      }
    }
  }

  // Orphaned nodes (not reachable via functional edges) get MAX_LEVEL
  for (const id of nodeIds) {
    if (!levels.has(id)) {
      levels.set(id, MAX_LEVEL)
    }
  }

  return levels
}

// ==================== Name Derivation ====================

export function deriveNodeName(node: Node): string {
  const id = node.id

  // For domain:X IDs (high-level nodes)
  if (id.startsWith('domain:')) {
    const featurePath = id.slice('domain:'.length)
    const parts = featurePath.split('/')
    return parts.at(-1) ?? featurePath
  }

  // For entity IDs like path/to/file.ts:class:MyClass:10
  const colonParts = id.split(':')
  if (colonParts.length >= 3) {
    return colonParts[2] ?? id
  }

  // For file-path IDs like path/to/file.ts:file or just path/to/file.ts
  if (colonParts.length === 2) {
    const filePath = colonParts[0]!
    const segments = filePath.split('/')
    return segments.at(-1) ?? id
  }

  // Fallback: use last path segment or the id itself
  const segments = id.split('/')
  return segments.at(-1) ?? id
}

// ==================== Entity Type Mapping ====================

function entityTypeToTypeName(entityType?: string): string | null {
  if (!entityType)
    return null
  const map: Record<string, string> = {
    file: 'file',
    class: 'class',
    function: 'function',
    method: 'method',
    module: 'module',
  }
  return map[entityType] ?? entityType
}

function typeNameToEntityType(typeName: string | null): 'file' | 'class' | 'function' | 'method' | 'module' | undefined {
  if (!typeName)
    return undefined
  const map: Record<string, 'file' | 'class' | 'function' | 'method' | 'module'> = {
    file: 'file',
    class: 'class',
    function: 'function',
    method: 'method',
    module: 'module',
  }
  return map[typeName]
}

// ==================== To Python Format ====================

export function toPythonNode(node: Node, level: number): PythonNode {
  if (isHighLevelNode(node)) {
    const paths = (node.metadata?.extra as Record<string, unknown> | undefined)?.paths
    const metaPath: string | string[] | null
      = node.directoryPath
        ?? (Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : null)
        ?? node.metadata?.path
        ?? null

    return {
      id: node.id,
      name: deriveNodeName(node),
      node_type: levelToNodeType(level),
      level,
      meta: {
        type_name: entityTypeToTypeName(node.metadata?.entityType) ?? 'directory',
        path: metaPath,
        description: node.feature.description,
        content: '',
      },
    }
  }

  // Low-level node
  return {
    id: node.id,
    name: deriveNodeName(node),
    node_type: levelToNodeType(level),
    level,
    meta: {
      type_name: entityTypeToTypeName(node.metadata?.entityType) ?? 'file',
      path: node.metadata?.path ?? null,
      description: node.feature.description,
      content: node.sourceCode ?? '',
    },
  }
}

export function toPythonEdge(edge: Edge): PythonEdge {
  if (isFunctionalEdge(edge)) {
    return {
      src: edge.source,
      dst: edge.target,
      relation: 'composes',
      meta: null,
    }
  }

  if (isDependencyEdge(edge)) {
    const relationMap: Record<string, string> = {
      import: 'imports',
      call: 'invokes',
      inherit: 'inherits',
      implement: 'inherits',
      use: 'invokes',
    }
    return {
      src: edge.source,
      dst: edge.target,
      relation: relationMap[edge.dependencyType] ?? 'invokes',
      meta: {
        type_name: edge.dependencyType,
        path: null,
        description: edge.symbol ?? '',
        content: '',
      },
    }
  }

  // data_flow edges are handled separately
  return {
    src: edge.source,
    dst: edge.target,
    relation: 'composes',
    meta: null,
  }
}

// ==================== From Python Format ====================

export function fromPythonNode(pNode: PythonNode): Node {
  const level = pNode.level ?? MAX_LEVEL
  const typeName = pNode.meta?.type_name ?? null

  // Determine if high-level or low-level
  const isHighLevel = level < MAX_LEVEL
    && (typeName === 'directory' || typeName === 'repo' || typeName === null)
    && !pNode.meta?.content

  if (isHighLevel) {
    const metaPath = pNode.meta?.path
    const directoryPath = typeof metaPath === 'string' ? metaPath : undefined
    return createHighLevelNode({
      id: pNode.id,
      feature: { description: pNode.meta?.description ?? '' },
      directoryPath,
      metadata: metaPath
        ? {
            entityType: typeNameToEntityType(typeName),
            path: typeof metaPath === 'string' ? metaPath : undefined,
            extra: Array.isArray(metaPath) ? { paths: metaPath } : undefined,
          }
        : undefined,
    })
  }

  return createLowLevelNode({
    id: pNode.id,
    feature: { description: pNode.meta?.description ?? '' },
    metadata: {
      entityType: typeNameToEntityType(typeName) ?? 'file',
      path: typeof pNode.meta?.path === 'string' ? pNode.meta.path : undefined,
    },
    sourceCode: pNode.meta?.content || undefined,
  })
}

export function fromPythonEdge(pEdge: PythonEdge): Edge {
  if (pEdge.relation === 'composes' || pEdge.relation === 'contains') {
    return createFunctionalEdge({
      source: pEdge.src,
      target: pEdge.dst,
    })
  }

  // Prefer original dependencyType from meta.type_name (preserves implement/use on round-trip)
  const originalType = pEdge.meta?.type_name as 'import' | 'call' | 'inherit' | 'implement' | 'use' | null
  const depTypeMap: Record<string, 'import' | 'call' | 'inherit' | 'implement' | 'use'> = {
    imports: 'import',
    invokes: 'call',
    inherits: 'inherit',
  }

  const dependencyType = originalType ?? depTypeMap[pEdge.relation] ?? 'use'
  return createDependencyEdge({
    source: pEdge.src,
    target: pEdge.dst,
    dependencyType,
    symbol: pEdge.meta?.description || undefined,
  })
}

export function toPythonDataFlow(edge: Edge): unknown {
  if (!isDataFlowEdge(edge))
    return null
  return {
    source: edge.source,
    target: edge.target,
    dataId: edge.dataId,
    dataType: edge.dataType,
    transformation: edge.transformation ?? '',
  }
}

export function fromPythonDataFlow(df: unknown): Edge | null {
  if (!df || typeof df !== 'object')
    return null
  const obj = df as Record<string, unknown>
  const source = obj.source as string | undefined
  const target = obj.target as string | undefined
  const dataId = (obj.dataId ?? obj.data_id) as string | undefined
  const dataType = (obj.dataType ?? obj.data_type) as string | undefined
  if (!source || !target || !dataId || !dataType)
    return null
  return createDataFlowEdge({
    source,
    target,
    dataId,
    dataType,
    transformation: (obj.transformation as string) || undefined,
  })
}
