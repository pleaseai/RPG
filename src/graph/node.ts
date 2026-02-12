import { z } from 'zod/v4'

/**
 * Node types in the Repository Planning Graph
 */
export const NodeType = {
  HighLevel: 'high_level',
  LowLevel: 'low_level',
} as const

export type NodeType = (typeof NodeType)[keyof typeof NodeType]

/**
 * Code entity types for low-level nodes
 */
export const EntityType = {
  File: 'file',
  Class: 'class',
  Function: 'function',
  Method: 'method',
  Module: 'module',
} as const

export type EntityType = (typeof EntityType)[keyof typeof EntityType]

/**
 * Semantic feature describing what the node does
 * Focus on purpose and behavior, not implementation
 */
export const SemanticFeatureSchema = z.object({
  /** Primary feature description (verb + object format) */
  description: z.string(),
  /** Additional atomic features if the node has multiple responsibilities */
  subFeatures: z.array(z.string()).optional(),
  /** Keywords for semantic search */
  keywords: z.array(z.string()).optional(),
})

export type SemanticFeature = z.infer<typeof SemanticFeatureSchema>

/**
 * Structural metadata for code entity attributes
 */
export const StructuralMetadataSchema = z.object({
  /** Entity type (file, class, function, etc.) */
  entityType: z.enum(['file', 'class', 'function', 'method', 'module']).optional(),
  /** File path relative to repository root */
  path: z.string().optional(),
  /** Start line number (1-indexed) */
  startLine: z.number().optional(),
  /** End line number (1-indexed) */
  endLine: z.number().optional(),
  /** Fully qualified name (e.g., "module.Class.method") */
  qualifiedName: z.string().optional(),
  /** Programming language */
  language: z.string().optional(),
  /** Additional metadata */
  extra: z.record(z.string(), z.unknown()).optional(),
})

export type StructuralMetadata = z.infer<typeof StructuralMetadataSchema>

/**
 * Base node schema with common properties
 */
export const BaseNodeSchema = z.object({
  /** Unique node identifier */
  id: z.string(),
  /** Node type (high_level or low_level) */
  type: z.enum(['high_level', 'low_level']),
  /** Semantic feature describing functionality */
  feature: SemanticFeatureSchema,
  /** Structural metadata (may be absent for high-level nodes) */
  metadata: StructuralMetadataSchema.optional(),
})

export type BaseNode = z.infer<typeof BaseNodeSchema>

/**
 * High-level node representing architectural directories/modules
 * These nodes have semantic features but may lack structural metadata
 */
export const HighLevelNodeSchema = BaseNodeSchema.extend({
  type: z.literal('high_level'),
  /** Directory path this node represents */
  directoryPath: z.string().optional(),
})

export type HighLevelNode = z.infer<typeof HighLevelNodeSchema>

/**
 * Low-level node representing atomic implementations
 * (files, classes, functions)
 */
export const LowLevelNodeSchema = BaseNodeSchema.extend({
  type: z.literal('low_level'),
  /** Required metadata for low-level nodes */
  metadata: StructuralMetadataSchema,
  /** Raw source code (optional, can be fetched on demand) */
  sourceCode: z.string().optional(),
})

export type LowLevelNode = z.infer<typeof LowLevelNodeSchema>

/**
 * Union type for all node types
 */
export const NodeSchema = z.discriminatedUnion('type', [HighLevelNodeSchema, LowLevelNodeSchema])

export type Node = z.infer<typeof NodeSchema>

/**
 * Create a high-level node
 */
export function createHighLevelNode(params: {
  id: string
  feature: SemanticFeature
  directoryPath?: string
  metadata?: StructuralMetadata
}): HighLevelNode {
  return HighLevelNodeSchema.parse({
    ...params,
    type: NodeType.HighLevel,
  })
}

/**
 * Create a low-level node
 */
export function createLowLevelNode(params: {
  id: string
  feature: SemanticFeature
  metadata: StructuralMetadata
  sourceCode?: string
}): LowLevelNode {
  return LowLevelNodeSchema.parse({
    ...params,
    type: NodeType.LowLevel,
  })
}

/**
 * Check if a node is high-level
 */
export function isHighLevelNode(node: Node): node is HighLevelNode {
  return node.type === NodeType.HighLevel
}

/**
 * Check if a node is low-level
 */
export function isLowLevelNode(node: Node): node is LowLevelNode {
  return node.type === NodeType.LowLevel
}
