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
  isDataFlowEdge,
  isDependencyEdge,
  isFunctionalEdge,
} from './edge'

export type { BaseEdge, DataFlowEdge, DependencyEdge, Edge, FunctionalEdge } from './edge'

// Fuzzy matching + node suggestions
export {
  levenshteinDistance,
  rankNodes,
  scoreCandidate,
  similarityRatio,
  suggestNodes,
} from './fuzzy'

export type { SuggestOptions } from './fuzzy'

// JSONL format (git-friendly graph serialization)
export { parseGraphJsonl, serializeGraphJsonl } from './jsonl'

// Meta (companion .meta.json file)
export { deserializeMeta, metaPathFor, RPGMetaSchema, serializeMeta } from './meta'

export type { RPGMeta } from './meta'

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

// Python-compatible format types
export {
  computeNodeLevels,
  fromPythonEdge,
  fromPythonNode,
  levelToNodeType,
  PythonEdgeSchema,
  PythonNodeSchema,
  PythonRPGSchema,
  toPythonEdge,
  toPythonNode,
} from './python-format'

export type { PythonEdge, PythonNode, PythonRPG } from './python-format'

// Repository Planning Graph
export { RepositoryPlanningGraph, SerializedRPGSchema } from './rpg'

export type { GitHubSource, GraphStats, RPGConfig, SerializedRPG } from './rpg'
