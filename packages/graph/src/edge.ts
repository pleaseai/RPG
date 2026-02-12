import { z } from 'zod/v4'

/**
 * Edge types in the Repository Planning Graph
 */
export const EdgeType = {
  /** Functional hierarchy edges (parent-child relationships) */
  Functional: 'functional',
  /** Dependency edges (imports, calls) */
  Dependency: 'dependency',
} as const

export type EdgeType = (typeof EdgeType)[keyof typeof EdgeType]

/**
 * Dependency relationship types
 */
export const DependencyType = {
  Import: 'import',
  Call: 'call',
  Inherit: 'inherit',
  Implement: 'implement',
  Use: 'use',
} as const

export type DependencyType = (typeof DependencyType)[keyof typeof DependencyType]

/**
 * Base edge schema
 */
export const BaseEdgeSchema = z.object({
  /** Source node ID */
  source: z.string(),
  /** Target node ID */
  target: z.string(),
  /** Edge type */
  type: z.enum(['functional', 'dependency']),
  /** Optional edge weight */
  weight: z.number().optional(),
})

export type BaseEdge = z.infer<typeof BaseEdgeSchema>

/**
 * Functional edge representing feature hierarchy
 * Parent-child relationships in the functional decomposition
 */
export const FunctionalEdgeSchema = BaseEdgeSchema.extend({
  type: z.literal('functional'),
  /** Hierarchical level (0 = root) */
  level: z.number().optional(),
  /** Order among siblings for topological sorting */
  siblingOrder: z.number().optional(),
})

export type FunctionalEdge = z.infer<typeof FunctionalEdgeSchema>

/**
 * Dependency edge representing code dependencies
 * Import/call relationships from AST analysis
 */
export const DependencyEdgeSchema = BaseEdgeSchema.extend({
  type: z.literal('dependency'),
  /** Type of dependency relationship */
  dependencyType: z.enum(['import', 'call', 'inherit', 'implement', 'use']),
  /** Whether this is a runtime or compile-time dependency */
  isRuntime: z.boolean().optional(),
  /** Line number where the dependency occurs */
  line: z.number().optional(),
})

export type DependencyEdge = z.infer<typeof DependencyEdgeSchema>

/**
 * Union type for all edge types
 */
export const EdgeSchema = z.discriminatedUnion('type', [FunctionalEdgeSchema, DependencyEdgeSchema])

export type Edge = z.infer<typeof EdgeSchema>

/**
 * Data flow edge for inter-module communication
 */
export const DataFlowEdgeSchema = z.object({
  /** Source module/subgraph */
  from: z.string(),
  /** Target module/subgraph */
  to: z.string(),
  /** Unique identifier for the data being passed */
  dataId: z.string(),
  /** Type or structure of the data */
  dataType: z.string(),
  /** Description of transformation applied to the data */
  transformation: z.string().optional(),
})

export type DataFlowEdge = z.infer<typeof DataFlowEdgeSchema>

/**
 * Create a data flow edge
 */
export function createDataFlowEdge(params: {
  from: string
  to: string
  dataId: string
  dataType: string
  transformation?: string
}): DataFlowEdge {
  return DataFlowEdgeSchema.parse(params)
}

/**
 * Create a functional edge
 */
export function createFunctionalEdge(params: {
  source: string
  target: string
  level?: number
  siblingOrder?: number
  weight?: number
}): FunctionalEdge {
  return FunctionalEdgeSchema.parse({
    ...params,
    type: EdgeType.Functional,
  })
}

/**
 * Create a dependency edge
 */
export function createDependencyEdge(params: {
  source: string
  target: string
  dependencyType: DependencyType
  isRuntime?: boolean
  line?: number
  weight?: number
}): DependencyEdge {
  return DependencyEdgeSchema.parse({
    ...params,
    type: EdgeType.Dependency,
  })
}

/**
 * Check if an edge is functional
 */
export function isFunctionalEdge(edge: Edge): edge is FunctionalEdge {
  return edge.type === EdgeType.Functional
}

/**
 * Check if an edge is a dependency
 */
export function isDependencyEdge(edge: Edge): edge is DependencyEdge {
  return edge.type === EdgeType.Dependency
}
