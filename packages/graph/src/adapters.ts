/**
 * Adapters: bidirectional converters between RPG domain types and generic store attrs.
 */
import type { EdgeAttrs, NodeAttrs } from '@pleaseai/rpg-store/types'
import type {
  DependencyEdge,
  Edge,
  FunctionalEdge,
  HighLevelNode,
  LowLevelNode,
  Node,
} from './index'
import type { StructuralMetadata } from './node'

// ==================== Node Adapters ====================

/** Convert a domain Node to generic NodeAttrs for storage */
export function nodeToAttrs(node: Node): NodeAttrs {
  const attrs: NodeAttrs = {
    type: node.type,
    feature_desc: node.feature.description,
  }

  if (node.feature.keywords)
    attrs.feature_keywords = node.feature.keywords
  if (node.feature.subFeatures)
    attrs.feature_sub = node.feature.subFeatures
  if (node.metadata?.entityType)
    attrs.entity_type = node.metadata.entityType
  if (node.metadata?.path)
    attrs.path = node.metadata.path
  if (node.metadata?.qualifiedName)
    attrs.qualified_name = node.metadata.qualifiedName
  if (node.metadata?.language)
    attrs.language = node.metadata.language
  if (node.metadata?.startLine != null)
    attrs.line_start = node.metadata.startLine
  if (node.metadata?.endLine != null)
    attrs.line_end = node.metadata.endLine
  if (node.metadata?.extra)
    attrs.extra = node.metadata.extra

  if (node.type === 'high_level' && (node as HighLevelNode).directoryPath) {
    attrs.directory_path = (node as HighLevelNode).directoryPath
  }
  if (node.type === 'low_level' && (node as LowLevelNode).sourceCode) {
    attrs.source_code = (node as LowLevelNode).sourceCode
  }

  return attrs
}

/** Reconstruct a typed Node from generic attrs */
export function attrsToNode(id: string, attrs: NodeAttrs): Node {
  const feature = {
    description: attrs.feature_desc as string,
    keywords: (attrs.feature_keywords as string[] | undefined) ?? undefined,
    subFeatures: (attrs.feature_sub as string[] | undefined) ?? undefined,
  }

  const metadata
    = attrs.entity_type || attrs.path
      ? ({
          entityType: (attrs.entity_type as StructuralMetadata['entityType']) ?? undefined,
          path: (attrs.path as string) ?? undefined,
          qualifiedName: (attrs.qualified_name as string) ?? undefined,
          language: (attrs.language as string) ?? undefined,
          startLine: (attrs.line_start as number) ?? undefined,
          endLine: (attrs.line_end as number) ?? undefined,
          extra: (attrs.extra as Record<string, unknown>) ?? undefined,
        } satisfies StructuralMetadata)
      : undefined

  if (attrs.type === 'high_level') {
    return {
      id,
      type: 'high_level' as const,
      feature,
      metadata,
      directoryPath: (attrs.directory_path as string) ?? undefined,
    } satisfies HighLevelNode
  }

  return {
    id,
    type: 'low_level' as const,
    feature,
    metadata: metadata ?? {},
    sourceCode: (attrs.source_code as string) ?? undefined,
  } satisfies LowLevelNode
}

/** Convert a Node to text-search fields */
export function nodeToSearchFields(node: Node): Record<string, string> {
  const fields: Record<string, string> = {
    feature_desc: node.feature.description,
  }

  if (node.feature.keywords?.length) {
    fields.feature_keywords = node.feature.keywords.join(' ')
  }
  if (node.metadata?.path) {
    fields.path = node.metadata.path
  }
  if (node.metadata?.qualifiedName) {
    fields.qualified_name = node.metadata.qualifiedName
  }

  return fields
}

// ==================== Edge Adapters ====================

/** Convert a domain Edge to generic EdgeAttrs for storage */
export function edgeToAttrs(edge: Edge): EdgeAttrs {
  const attrs: EdgeAttrs = { type: edge.type }

  if (edge.weight != null)
    attrs.weight = edge.weight

  if (edge.type === 'functional') {
    const fe = edge as FunctionalEdge
    if (fe.level != null)
      attrs.level = fe.level
    if (fe.siblingOrder != null)
      attrs.sibling_order = fe.siblingOrder
  }
  else {
    const de = edge as DependencyEdge
    if (de.dependencyType)
      attrs.dep_type = de.dependencyType
    if (de.isRuntime != null)
      attrs.is_runtime = de.isRuntime
    if (de.line != null)
      attrs.dep_line = de.line
  }

  return attrs
}

/** Reconstruct a typed Edge from generic attrs */
export function attrsToEdge(source: string, target: string, attrs: EdgeAttrs): Edge {
  if (attrs.type === 'functional') {
    return {
      source,
      target,
      type: 'functional' as const,
      level: (attrs.level as number) ?? undefined,
      siblingOrder: (attrs.sibling_order as number) ?? undefined,
      weight: (attrs.weight as number) ?? undefined,
    }
  }

  return {
    source,
    target,
    type: 'dependency' as const,
    dependencyType: ((attrs.dep_type as string) ?? 'use') as
    | 'import'
    | 'call'
    | 'inherit'
    | 'implement'
    | 'use',
    isRuntime: (attrs.is_runtime as boolean) ?? undefined,
    line: (attrs.dep_line as number) ?? undefined,
    weight: (attrs.weight as number) ?? undefined,
  }
}
