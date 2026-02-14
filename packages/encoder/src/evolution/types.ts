import type { EntityType } from '@pleaseai/rpg-graph/node'
import type { SemanticOptions } from '../semantic'

/**
 * Options for evolving an RPG with new commits
 */
export interface EvolutionOptions {
  /** Commit range (e.g., "HEAD~1..HEAD", "abc123..def456") */
  commitRange: string
  /** Repository path */
  repoPath: string
  /** Cosine distance threshold for semantic drift (default 0.3) */
  driftThreshold?: number
  /** Use LLM for semantic routing (default true) */
  useLLM?: boolean
  /** Semantic extraction options */
  semantic?: SemanticOptions
  /** Include source code in nodes */
  includeSource?: boolean
}

/**
 * Result of an evolution operation
 */
export interface EvolutionResult {
  /** Number of entities inserted */
  inserted: number
  /** Number of entities deleted */
  deleted: number
  /** Number of entities modified in-place */
  modified: number
  /** Number of modified entities that triggered re-routing (semantic drift) */
  rerouted: number
  /** Number of empty ancestor nodes pruned */
  prunedNodes: number
  /** Duration in milliseconds */
  duration: number
  /** Number of LLM calls made (for cost measurement) */
  llmCalls: number
  /** Errors encountered during evolution (partial failures) */
  errors: Array<{ entity: string, phase: string, error: string }>
  /** Node IDs changed during evolution (for incremental embedding updates) */
  embeddingChanges?: { added: string[], removed: string[], modified: string[] }
}

/**
 * A changed entity detected from git diff
 */
export interface ChangedEntity {
  /** Stable ID: filePath:entityType:qualifiedName */
  id: string
  /** File path relative to repository root */
  filePath: string
  /** Entity type */
  entityType: EntityType
  /** Entity name */
  entityName: string
  /** Qualified name (e.g., "MyClass.myMethod" for nested entities) */
  qualifiedName: string
  /** Source code of the entity */
  sourceCode?: string
  /** Start line (1-indexed) */
  startLine?: number
  /** End line (1-indexed) */
  endLine?: number
}

/**
 * Result of parsing git diff into entity-level changes
 *
 * U+ = insertions, U- = deletions, U~ = modifications
 */
export interface DiffResult {
  /** New entities (U+) */
  insertions: ChangedEntity[]
  /** Deleted entities (U-) */
  deletions: ChangedEntity[]
  /** Modified entities (U~) — entities present in both old and new with changed source */
  modifications: Array<{
    old: ChangedEntity
    new: ChangedEntity
  }>
}

/**
 * File-level change status from git diff --name-status
 */
export type FileChangeStatus = 'A' | 'M' | 'D'

/**
 * A file-level change from git diff
 */
export interface FileChange {
  /** Change status */
  status: FileChangeStatus
  /** File path (relative to repo root) */
  filePath: string
  /** Old file path (for renames) */
  oldFilePath?: string
}

/**
 * Default drift threshold (cosine distance)
 * Conservative: 30% semantic change triggers re-routing
 */
export const DEFAULT_DRIFT_THRESHOLD = 0.3
