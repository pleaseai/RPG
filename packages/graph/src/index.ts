// Adapters: RPG domain types ↔ generic store attrs
export {
  attrsToEdge,
  attrsToNode,
  edgeToAttrs,
  nodeToAttrs,
  nodeToSearchFields,
} from './adapters'

// Edge types and utilities
export {
  BaseEdgeSchema,
  createDataFlowEdge,
  createDependencyEdge,
  createFunctionalEdge,
  DataFlowEdgeSchema,
  DependencyEdgeSchema,
  DependencyType,
  EdgeSchema,
  EdgeType,
  FunctionalEdgeSchema,
  isDependencyEdge,
  isFunctionalEdge,
} from './edge'

export type { BaseEdge, DataFlowEdge, DependencyEdge, Edge, FunctionalEdge } from './edge'

// Node types and utilities
export {
  BaseNodeSchema,
  createHighLevelNode,
  createLowLevelNode,
  EntityType,
  HighLevelNodeSchema,
  isHighLevelNode,
  isLowLevelNode,
  LowLevelNodeSchema,
  NodeSchema,
  NodeType,
  SemanticFeatureSchema,
  StructuralMetadataSchema,
} from './node'

export type {
  BaseNode,
  HighLevelNode,
  LowLevelNode,
  Node,
  SemanticFeature,
  StructuralMetadata,
} from './node'

// Repository Planning Graph
export { RepositoryPlanningGraph, SerializedRPGSchema } from './rpg'

export type { GitHubSource, RPGConfig, SerializedRPG } from './rpg'

// GraphStore interface and types
export type {
  EdgeFilter,
  GraphStats,
  GraphStore,
  NodeFilter,
  SearchHit,
  TraverseOptions,
  TraverseResult,
} from './store'

// Legacy store implementations - import directly to avoid loading engine dependencies:
//   import { SQLiteStore } from '@pleaseai/rpg-graph/sqlite-store'   // requires better-sqlite3
//   import { SurrealStore } from '@pleaseai/rpg-graph/surreal-store'  // requires surrealdb + @surrealdb/node
//
// New store implementations - import from @pleaseai/rpg-store:
//   import { SQLiteGraphStore, SQLiteTextSearchStore } from '@pleaseai/rpg-store/sqlite'
//   import { SurrealGraphStore, SurrealTextSearchStore } from '@pleaseai/rpg-store/surreal'
//   import { LanceDBVectorStore } from '@pleaseai/rpg-store/lancedb'
