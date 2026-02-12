export { DiffParser } from './diff-parser'
export { RPGEvolver } from './evolve'
export { deleteNode, findMatchingNode, insertNode, processModification } from './operations'
export type { OperationContext } from './operations'
export { buildSemanticRoutingPrompt } from './prompts'
export type { SemanticRoutingResponse } from './prompts'
export { cosineSimilarity, SemanticRouter } from './semantic-router'
export type {
  ChangedEntity,
  DiffResult,
  EvolutionOptions,
  EvolutionResult,
  FileChange,
  FileChangeStatus,
} from './types'
export { DEFAULT_DRIFT_THRESHOLD } from './types'
