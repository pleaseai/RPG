import type { RepositoryPlanningGraph } from '../../graph'
import { createHash } from 'node:crypto'

/**
 * An entity that can be semantically lifted by the agent
 */
export interface LiftableEntity {
  id: string
  name: string
  entityType: 'file' | 'class' | 'function' | 'method'
  filePath: string
  sourceCode: string | undefined
  startLine?: number
  endLine?: number
  parentClass?: string
}

/**
 * An entity pending routing to a new location in the hierarchy
 */
export interface PendingRouting {
  entityId: string
  features: string[]
  currentPath: string
  reason: 'drifted' | 'newly_lifted' | 'borderline'
}

/**
 * Features submitted for a file-level entity
 */
export interface FileFeatures {
  fileId: string
  filePath: string
  description: string
  keywords: string[]
}

/**
 * Hierarchy assignment for a file
 */
export interface HierarchyAssignment {
  filePath: string
  /** 3-level path: "Area/category/subcategory" */
  hierarchyPath: string
}

/**
 * Token-aware batching constants
 */
const DEFAULT_MAX_TOKENS_PER_BATCH = 12_000
const DEFAULT_MAX_ENTITIES_PER_BATCH = 15

/**
 * Interactive encoding state management.
 *
 * Maintains the entity cache, batch boundaries, pending routing queue,
 * and graph revision tracking for the interactive encoding protocol.
 */
export class InteractiveState {
  rpg: RepositoryPlanningGraph | null = null
  repoPath: string | null = null

  /** All liftable entities extracted from the repository */
  entities: LiftableEntity[] = []

  /** Batch boundaries as [startIdx, endIdx) pairs */
  batchBoundaries: Array<[number, number]> = []

  /** Features submitted per entity ID */
  liftedFeatures: Map<string, string[]> = new Map()

  /** File-level features after finalization */
  fileFeatures: FileFeatures[] = []

  /** Synthesized file features */
  synthesizedFeatures: Map<string, { description: string, keywords: string[] }> = new Map()

  /** Hierarchy assignments */
  hierarchyAssignments: HierarchyAssignment[] = []

  /** Entities pending routing decisions */
  pendingRouting: PendingRouting[] = []

  /**
   * Compute a SHA-256 revision hash of the current graph state.
   * Used for optimistic concurrency control in routing decisions.
   */
  getGraphRevision(): string {
    const entities = this.entities
      .map(e => e.id)
      .sort((a, b) => a.localeCompare(b))

    const lifted = [...this.liftedFeatures.entries()]
      .sort(([idA], [idB]) => idA.localeCompare(idB))
      .map(([entityId, features]) => ({
        entityId,
        features: [...features].sort((a, b) => a.localeCompare(b)),
      }))

    const routing = this.pendingRouting
      .slice()
      .sort((a, b) => {
        const byEntity = a.entityId.localeCompare(b.entityId)
        if (byEntity !== 0)
          return byEntity
        return a.currentPath.localeCompare(b.currentPath)
      })
      .map(r => ({
        entityId: r.entityId,
        features: [...r.features].sort((a, b) => a.localeCompare(b)),
        currentPath: r.currentPath,
        reason: r.reason,
      }))

    const hierarchy = this.hierarchyAssignments
      .map(a => `${a.filePath}:${a.hierarchyPath}`)
      .sort((a, b) => a.localeCompare(b))

    const data = JSON.stringify({
      entities,
      lifted,
      routing,
      hierarchy,
    })
    return createHash('sha256').update(data).digest('hex').slice(0, 12)
  }

  /**
   * Build token-aware batches from the entity list.
   *
   * Each batch respects both a token budget (estimated as sourceCode.length / 4)
   * and a maximum entity count.
   */
  buildBatches(
    maxTokens: number = DEFAULT_MAX_TOKENS_PER_BATCH,
    maxEntities: number = DEFAULT_MAX_ENTITIES_PER_BATCH,
  ): void {
    this.batchBoundaries = []
    let batchStart = 0
    let batchTokens = 0

    for (let i = 0; i < this.entities.length; i++) {
      const entity = this.entities[i]!
      const entityTokens = Math.ceil((entity.sourceCode?.length ?? 0) / 4)

      // Start new batch if adding this entity would exceed limits
      if (i > batchStart && (batchTokens + entityTokens > maxTokens || i - batchStart >= maxEntities)) {
        this.batchBoundaries.push([batchStart, i])
        batchStart = i
        batchTokens = 0
      }

      batchTokens += entityTokens
    }

    // Final batch
    if (batchStart < this.entities.length) {
      this.batchBoundaries.push([batchStart, this.entities.length])
    }
  }

  /**
   * Get the number of entities that have been lifted (features submitted)
   */
  getLiftedCount(): number {
    return this.liftedFeatures.size
  }

  /**
   * Get the total number of liftable entities
   */
  getTotalCount(): number {
    return this.entities.length
  }

  /**
   * Get the coverage percentage (lifted / total)
   */
  getCoveragePercent(): number {
    if (this.entities.length === 0)
      return 0
    return (this.liftedFeatures.size / this.entities.length) * 100
  }

  /**
   * Get entities for a specific batch index
   */
  getBatchEntities(batchIndex: number): LiftableEntity[] {
    const boundary = this.batchBoundaries[batchIndex]
    if (!boundary)
      return []
    const [start, end] = boundary
    return this.entities.slice(start, end)
  }

  /**
   * Get entities filtered by scope.
   * '*' means all entities; otherwise filter by file path prefix.
   */
  getEntitiesByScope(scope: string): LiftableEntity[] {
    if (scope === '*')
      return this.entities
    return this.entities.filter(e => e.filePath.startsWith(scope))
  }

  /**
   * Reset state for a new encoding session
   */
  reset(): void {
    this.entities = []
    this.batchBoundaries = []
    this.liftedFeatures.clear()
    this.fileFeatures = []
    this.synthesizedFeatures.clear()
    this.hierarchyAssignments = []
    this.pendingRouting = []
  }
}
