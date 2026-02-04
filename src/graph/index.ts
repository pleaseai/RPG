// Node types and utilities
export {
  NodeType,
  EntityType,
  SemanticFeatureSchema,
  StructuralMetadataSchema,
  BaseNodeSchema,
  HighLevelNodeSchema,
  LowLevelNodeSchema,
  NodeSchema,
  createHighLevelNode,
  createLowLevelNode,
  isHighLevelNode,
  isLowLevelNode,
} from './node'

export type {
  SemanticFeature,
  StructuralMetadata,
  BaseNode,
  HighLevelNode,
  LowLevelNode,
  Node,
} from './node'

// Edge types and utilities
export {
  EdgeType,
  DependencyType,
  BaseEdgeSchema,
  FunctionalEdgeSchema,
  DependencyEdgeSchema,
  EdgeSchema,
  DataFlowEdgeSchema,
  createFunctionalEdge,
  createDependencyEdge,
  isFunctionalEdge,
  isDependencyEdge,
} from './edge'

export type { BaseEdge, FunctionalEdge, DependencyEdge, Edge, DataFlowEdge } from './edge'

// Repository Planning Graph
export { RepositoryPlanningGraph, SerializedRPGSchema } from './rpg'

export type { RPGConfig, SerializedRPG } from './rpg'

// GraphStore interface and types
export type {
  GraphStore,
  NodeFilter,
  EdgeFilter,
  TraverseOptions,
  TraverseResult,
  SearchHit,
  GraphStats,
} from './store'

// Store implementations - import directly to avoid loading engine dependencies:
//   import { SQLiteStore } from './graph/sqlite-store'   // requires bun:sqlite
//   import { SurrealStore } from './graph/surreal-store'  // requires surrealdb + @surrealdb/node
