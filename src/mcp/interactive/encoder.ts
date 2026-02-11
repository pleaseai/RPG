import type { RPGConfig } from '../../graph'
import type { FileFeatures, InteractiveState, LiftableEntity } from './state'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  discoverFiles,
  extractEntitiesFromFile,
  injectDependencies,
} from '../../encoder/encoder'
import { ArtifactGrounder } from '../../encoder/grounding'
import { RepositoryPlanningGraph } from '../../graph'
import { ASTParser } from '../../utils/ast'
import {
  DOMAIN_DISCOVERY_INSTRUCTIONS,
  FILE_SYNTHESIS_INSTRUCTIONS,
  HIERARCHY_ASSIGNMENT_INSTRUCTIONS,
  ROUTING_INSTRUCTIONS,
  SEMANTIC_PARSING_INSTRUCTIONS,
} from './prompt-texts'

/**
 * Result returned by mutation operations
 */
export interface SubmitResult {
  success: boolean
  entitiesProcessed: number
  coveragePercent: number
  driftDetected?: number
  warnings?: string[]
  nextAction: string
}

/**
 * Result from building the structural index
 */
export interface BuildResult {
  success: boolean
  entities: number
  files: number
  batches: number
  nextAction: string
}

/**
 * Interactive encoder business logic.
 *
 * Read methods are used by MCP resources, write methods by MCP tools.
 * All methods operate on shared InteractiveState.
 */
export class InteractiveEncoder {
  private readonly state: InteractiveState
  private readonly astParser: ASTParser
  /** Index for O(1) entity lookup by ID, built on first use */
  private entityIndex: Map<string, LiftableEntity> | null = null

  constructor(state: InteractiveState) {
    this.state = state
    this.astParser = new ASTParser()
  }

  private getEntityById(id: string): LiftableEntity | undefined {
    if (!this.entityIndex) {
      this.entityIndex = new Map(this.state.entities.map(e => [e.id, e]))
    }
    return this.entityIndex.get(id)
  }

  private invalidateEntityIndex(): void {
    this.entityIndex = null
  }

  /**
   * Build structural graph from repository (AST + deps, no semantic features).
   */
  async buildIndex(
    repoPath: string,
    opts?: { include?: string[], exclude?: string[] },
  ): Promise<BuildResult> {
    this.state.reset()
    this.state.repoPath = repoPath

    const repoName = path.basename(repoPath).toLowerCase() || 'unknown'
    const config: RPGConfig = { name: repoName, rootPath: repoPath }

    const rpg = await RepositoryPlanningGraph.create(config)
    this.state.rpg = rpg

    // Discover and parse files
    const files = await discoverFiles(repoPath, {
      include: opts?.include,
      exclude: opts?.exclude,
    })

    const allEntities: LiftableEntity[] = []

    for (const file of files) {
      const extraction = await extractEntitiesFromFile(file, repoPath, this.astParser)

      // Add file-level node with placeholder feature
      await rpg.addLowLevelNode({
        id: extraction.fileEntityId,
        feature: { description: `[pending] ${extraction.relativePath}`, keywords: [] },
        metadata: { entityType: 'file', path: extraction.relativePath },
        sourceCode: extraction.sourceCode,
      })

      allEntities.push({
        id: extraction.fileEntityId,
        name: path.basename(extraction.relativePath),
        entityType: 'file',
        filePath: extraction.relativePath,
        sourceCode: extraction.sourceCode,
      })

      // Add child entities
      for (const entity of extraction.entities) {
        await rpg.addLowLevelNode({
          id: entity.id,
          feature: { description: `[pending] ${entity.codeEntity.name}`, keywords: [] },
          metadata: {
            entityType: entity.entityType,
            path: extraction.relativePath,
            startLine: entity.codeEntity.startLine,
            endLine: entity.codeEntity.endLine,
          },
          sourceCode: entity.sourceCode,
        })

        // File → child edge
        await rpg.addFunctionalEdge({
          source: extraction.fileEntityId,
          target: entity.id,
        })

        allEntities.push({
          id: entity.id,
          name: entity.codeEntity.name,
          entityType: entity.entityType,
          filePath: extraction.relativePath,
          sourceCode: entity.sourceCode,
          startLine: entity.codeEntity.startLine,
          endLine: entity.codeEntity.endLine,
          parentClass: entity.codeEntity.parent,
        })
      }
    }

    // Inject dependency edges
    await injectDependencies(rpg, repoPath, this.astParser)

    // Store entities and build batches
    this.state.entities = allEntities
    this.invalidateEntityIndex()
    this.state.buildBatches()

    await this.persistGraph()

    return {
      success: true,
      entities: allEntities.length,
      files: files.length,
      batches: this.state.batchBoundaries.length,
      nextAction: `Read rpg://encoding/entities/*/0 for the first batch`,
    }
  }

  /**
   * Get markdown coverage dashboard
   */
  getStatus(): string {
    const s = this.state
    const lifted = s.getLiftedCount()
    const total = s.getTotalCount()
    const pct = s.getCoveragePercent().toFixed(1)
    const batches = s.batchBoundaries.length
    const routing = s.pendingRouting.length
    const hierarchy = s.hierarchyAssignments.length
    const synthesized = s.synthesizedFeatures.size

    // Determine current phase
    let phase = 'Not started'
    let nextStep = 'Call rpg_build_index to begin'

    if (total > 0 && lifted === 0) {
      phase = 'Index built'
      nextStep = 'Read rpg://encoding/entities/*/0 to begin semantic lifting'
    }
    else if (lifted > 0 && lifted < total) {
      const nextBatch = this.findNextUnliftedBatch()
      phase = 'Lifting in progress'
      nextStep = nextBatch !== null
        ? `Read rpg://encoding/entities/*/${nextBatch} for the next batch`
        : 'Call rpg_finalize_features to aggregate'
    }
    else if (lifted === total && total > 0 && synthesized === 0) {
      phase = 'Lifting complete'
      nextStep = s.fileFeatures.length === 0
        ? 'Call rpg_finalize_features to aggregate file features'
        : 'Read rpg://encoding/synthesis/0 for file-level synthesis'
    }
    else if (synthesized > 0 && hierarchy === 0) {
      phase = 'Synthesis complete'
      nextStep = 'Read rpg://encoding/hierarchy for hierarchy construction'
    }
    else if (hierarchy > 0 && routing === 0) {
      phase = 'Hierarchy built'
      nextStep = 'Done. Use rpg_search to verify the RPG.'
    }
    else if (routing > 0) {
      phase = 'Routing pending'
      nextStep = 'Read rpg://encoding/routing/0 for routing candidates'
    }

    return [
      `# RPG Encoding Status`,
      ``,
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Phase | ${phase} |`,
      `| Entities | ${total} |`,
      `| Lifted | ${lifted} / ${total} (${pct}%) |`,
      `| Batches | ${batches} |`,
      `| File features | ${s.fileFeatures.length} |`,
      `| Synthesized | ${synthesized} |`,
      `| Hierarchy | ${hierarchy} assignments |`,
      `| Pending routing | ${routing} |`,
      `| Graph revision | ${s.getGraphRevision()} |`,
      ``,
      `## Next Step`,
      nextStep,
    ].join('\n')
  }

  /**
   * Get entity batch with source code.
   * Batch 0 includes SEMANTIC_PARSING_INSTRUCTIONS.
   */
  getEntityBatch(scope: string, batchIndex: number): string {
    const scopedEntities = this.state.getEntitiesByScope(scope)
    if (scopedEntities.length === 0) {
      return `No entities found for scope "${scope}". Build the index first with rpg_build_index.`
    }

    // If scope is '*', use pre-computed batch boundaries
    if (scope === '*') {
      const entities = this.state.getBatchEntities(batchIndex)
      if (entities.length === 0) {
        return `Batch ${batchIndex} is out of range. Total batches: ${this.state.batchBoundaries.length}.`
      }
      return this.formatEntityBatch(entities, batchIndex, this.state.batchBoundaries.length)
    }

    // For scoped queries, re-batch on the fly
    const batchSize = 15
    const start = batchIndex * batchSize
    const end = Math.min(start + batchSize, scopedEntities.length)
    const totalBatches = Math.ceil(scopedEntities.length / batchSize)

    if (start >= scopedEntities.length) {
      return `Batch ${batchIndex} is out of range. Total batches: ${totalBatches}.`
    }

    return this.formatEntityBatch(scopedEntities.slice(start, end), batchIndex, totalBatches, start, scopedEntities.length)
  }

  private formatEntityBatch(entities: LiftableEntity[], batchIndex: number, totalBatches: number, startIdx?: number, totalEntities?: number): string {
    const total = totalEntities ?? this.state.getTotalCount()
    const effectiveStartIdx = startIdx ?? (batchIndex === 0 ? 0 : this.state.batchBoundaries[batchIndex]?.[0] ?? 0)
    const endIdx = effectiveStartIdx + entities.length - 1

    const parts: string[] = []

    if (batchIndex === 0) {
      parts.push(SEMANTIC_PARSING_INSTRUCTIONS)
      parts.push('')
    }

    parts.push(`## Batch ${batchIndex} of ${totalBatches} (entities ${effectiveStartIdx}–${endIdx} of ${total})`)
    parts.push('')

    for (const entity of entities) {
      this.formatEntity(entity, parts)
    }

    if (batchIndex + 1 < totalBatches) {
      parts.push(`## NEXT: Read rpg://encoding/entities/*/${batchIndex + 1} for the next batch`)
    }
    else {
      parts.push('## All batches read. Call rpg_submit_features for any remaining, then rpg_finalize_features.')
    }

    return parts.join('\n')
  }

  private formatEntity(entity: LiftableEntity, parts: string[]): void {
    const lifted = this.state.liftedFeatures.has(entity.id)
    const status = lifted ? ' ✓' : ''
    parts.push(`### ${entity.id}${status}`)
    parts.push(`- Type: ${entity.entityType}`)
    parts.push(`- File: ${entity.filePath}`)
    if (entity.startLine) {
      parts.push(`- Lines: ${entity.startLine}–${entity.endLine}`)
    }
    if (entity.parentClass) {
      parts.push(`- Parent class: ${entity.parentClass}`)
    }
    if (entity.sourceCode) {
      const code = entity.sourceCode.length > 3000
        ? `${entity.sourceCode.slice(0, 3000)}\n... (truncated, ${entity.sourceCode.length} chars total)`
        : entity.sourceCode
      parts.push('```')
      parts.push(code)
      parts.push('```')
    }
    parts.push('')
  }

  /**
   * Apply semantic features to entities.
   * Detects drift and queues routing for drifted entities.
   */
  async submitFeatures(featuresJson: string): Promise<SubmitResult> {
    let features: Record<string, string[]>
    try {
      features = JSON.parse(featuresJson)
    }
    catch {
      throw new Error('Invalid JSON. Expected: {"entity_id": ["feature1", "feature2"], ...}')
    }

    this.validateEntityIds(Object.keys(features))

    let processed = 0
    let driftDetected = 0

    for (const [entityId, featureList] of Object.entries(features)) {
      const entity = this.getEntityById(entityId)!
      const deduped = this.normalizeFeatures(featureList)

      if (this.detectAndQueueDrift(entityId, deduped, entity.filePath)) {
        driftDetected++
      }

      this.state.liftedFeatures.set(entityId, deduped)
      await this.updateGraphNodeFeature(entityId, deduped)
      processed++
    }

    await this.persistGraph()

    const nextBatch = this.findNextUnliftedBatch()
    const nextAction = nextBatch !== null
      ? `Read rpg://encoding/entities/*/${nextBatch} for the next batch`
      : 'All entities lifted. Call rpg_finalize_features to aggregate.'

    return {
      success: true,
      entitiesProcessed: processed,
      coveragePercent: this.state.getCoveragePercent(),
      driftDetected: driftDetected > 0 ? driftDetected : undefined,
      nextAction,
    }
  }

  private validateEntityIds(entityIds: string[]): void {
    const notFound = entityIds.filter(id => !this.getEntityById(id))
    if (notFound.length > 0) {
      throw new Error(`Entity not found: ${notFound.join(', ')}. Use rpg://encoding/entities to see valid IDs.`)
    }
  }

  private normalizeFeatures(featureList: string[]): string[] {
    const normalized = featureList.map(f => f.toLowerCase().trim()).filter(Boolean)
    return [...new Set(normalized)]
  }

  private detectAndQueueDrift(entityId: string, newFeatures: string[], currentPath: string): boolean {
    const existing = this.state.liftedFeatures.get(entityId)
    if (!existing)
      return false

    const jaccard = jaccardDistance(new Set(existing), new Set(newFeatures))
    if (jaccard <= 0.5)
      return false

    this.state.pendingRouting.push({
      entityId,
      features: newFeatures,
      currentPath,
      reason: 'drifted',
    })
    return true
  }

  private async updateGraphNodeFeature(entityId: string, deduped: string[]): Promise<void> {
    if (!this.state.rpg)
      return

    const node = await this.state.rpg.getNode(entityId)
    if (!node)
      return

    await this.state.rpg.updateNode(entityId, {
      ...node,
      feature: {
        description: deduped[0] ?? '',
        subFeatures: deduped.slice(1),
        keywords: deduped.flatMap(f => f.split(' ')).filter(w => w.length > 2),
      },
    })
  }

  /**
   * Aggregate file-level features from child entity features.
   * Auto-routes any pending entities.
   */
  async finalizeFeatures(): Promise<SubmitResult> {
    const fileEntities = this.state.entities.filter(e => e.entityType === 'file')
    const fileFeatures: FileFeatures[] = []

    for (const file of fileEntities) {
      const features = this.state.liftedFeatures.get(file.id)
      if (!features || features.length === 0)
        continue

      // Collect child features
      const children = this.state.entities.filter(
        e => e.filePath === file.filePath && e.entityType !== 'file',
      )
      const childFeatures = children
        .flatMap(c => this.state.liftedFeatures.get(c.id) ?? [])
        .filter(Boolean)

      // Deduplicate all features for this file
      const allFeatures = [...new Set([...features, ...childFeatures])]

      fileFeatures.push({
        fileId: file.id,
        filePath: file.filePath,
        description: features[0] ?? '',
        keywords: allFeatures.flatMap(f => f.split(' ')).filter(w => w.length > 2),
      })
    }

    this.state.fileFeatures = fileFeatures

    await this.persistGraph()

    const pending = this.state.pendingRouting.length
    const nextAction = pending > 0
      ? `${pending} entities need routing. Read rpg://encoding/routing/0.`
      : 'Read rpg://encoding/synthesis/0 for file-level synthesis.'

    return {
      success: true,
      entitiesProcessed: fileFeatures.length,
      coveragePercent: this.state.getCoveragePercent(),
      nextAction,
    }
  }

  /**
   * Get file-level features for synthesis
   */
  getSynthesisBatch(batchIndex: number): string {
    const batchSize = 15
    const files = this.state.fileFeatures
    const start = batchIndex * batchSize
    const end = Math.min(start + batchSize, files.length)
    const totalBatches = Math.ceil(files.length / batchSize)

    if (files.length === 0) {
      return 'No file features available. Call rpg_finalize_features first.'
    }

    if (start >= files.length) {
      return `Batch ${batchIndex} is out of range. Total batches: ${totalBatches}.`
    }

    const batch = files.slice(start, end)
    const parts: string[] = []

    if (batchIndex === 0) {
      parts.push(FILE_SYNTHESIS_INSTRUCTIONS)
      parts.push('')
    }

    parts.push(`## Synthesis Batch ${batchIndex} of ${totalBatches} (files ${start}–${end - 1} of ${files.length})`)
    parts.push('')

    for (const file of batch) {
      const synthesized = this.state.synthesizedFeatures.has(file.filePath)
      const status = synthesized ? ' ✓' : ''
      parts.push(`### ${file.filePath}${status}`)
      parts.push(`- Description: ${file.description}`)
      parts.push(`- Keywords: ${file.keywords.join(', ')}`)

      // Include child entity features for context
      const children = this.state.entities.filter(
        e => e.filePath === file.filePath && e.entityType !== 'file',
      )
      if (children.length > 0) {
        parts.push('- Child entities:')
        for (const child of children) {
          const features = this.state.liftedFeatures.get(child.id) ?? []
          parts.push(`  - ${child.name} (${child.entityType}): ${features.join(', ')}`)
        }
      }
      parts.push('')
    }

    if (batchIndex + 1 < totalBatches) {
      parts.push(`## NEXT: Read rpg://encoding/synthesis/${batchIndex + 1} for the next batch`)
    }
    else {
      parts.push('## All files shown. Submit synthesis via rpg_submit_synthesis.')
    }

    return parts.join('\n')
  }

  /**
   * Apply holistic file-level feature synthesis
   */
  async submitSynthesis(synthesisJson: string): Promise<SubmitResult> {
    let synthesis: Record<string, { description: string, keywords: string[] }>
    try {
      synthesis = JSON.parse(synthesisJson)
    }
    catch {
      throw new Error('Invalid JSON. Expected: {"file_path": {"description": "...", "keywords": [...]}, ...}')
    }

    let processed = 0
    const notFound: string[] = []

    for (const [filePath, features] of Object.entries(synthesis)) {
      const fileEntityId = `${filePath}:file`
      const fileEntity = this.getEntityById(fileEntityId)
      if (!fileEntity) {
        notFound.push(filePath)
        continue
      }

      this.state.synthesizedFeatures.set(filePath, features)

      // Update graph node
      if (this.state.rpg) {
        const node = await this.state.rpg.getNode(fileEntity.id)
        if (node) {
          await this.state.rpg.updateNode(fileEntity.id, {
            ...node,
            feature: {
              description: features.description,
              keywords: features.keywords,
            },
          })
        }
      }

      processed++
    }

    if (notFound.length > 0) {
      throw new Error(`File not found: ${notFound.join(', ')}. Use rpg://encoding/synthesis to see valid paths.`)
    }

    await this.persistGraph()

    const totalFiles = this.state.fileFeatures.length
    const synthesized = this.state.synthesizedFeatures.size
    const nextAction = synthesized >= totalFiles
      ? 'Read rpg://encoding/hierarchy for hierarchy construction.'
      : `${totalFiles - synthesized} files remaining. Continue reading synthesis batches.`

    return {
      success: true,
      entitiesProcessed: processed,
      coveragePercent: this.state.getCoveragePercent(),
      nextAction,
    }
  }

  /**
   * Get hierarchy context: file features + domain discovery instructions
   */
  getHierarchyContext(): string {
    const parts: string[] = []

    parts.push(DOMAIN_DISCOVERY_INSTRUCTIONS)
    parts.push('')
    parts.push(HIERARCHY_ASSIGNMENT_INSTRUCTIONS)
    parts.push('')
    parts.push('## File Features')
    parts.push('')

    for (const file of this.state.fileFeatures) {
      const synthesized = this.state.synthesizedFeatures.get(file.filePath)
      const desc = synthesized?.description ?? file.description
      const kw = synthesized?.keywords ?? file.keywords
      parts.push(`- **${file.filePath}**: ${desc}`)
      parts.push(`  Keywords: ${kw.join(', ')}`)
    }

    return parts.join('\n')
  }

  /**
   * Apply 3-level hierarchy assignments to files
   */
  async submitHierarchy(assignmentsJson: string): Promise<SubmitResult> {
    let assignments: Record<string, string>
    try {
      assignments = JSON.parse(assignmentsJson)
    }
    catch {
      throw new Error('Invalid JSON. Expected: {"file_path": "Area/category/subcategory", ...}')
    }

    let processed = 0
    const notFound: string[] = []

    for (const [filePath, hierarchyPath] of Object.entries(assignments)) {
      const fileEntityId = `${filePath}:file`
      const fileEntity = this.getEntityById(fileEntityId)
      if (!fileEntity) {
        notFound.push(filePath)
        continue
      }

      // Upsert: replace existing assignment or append new one
      const existingIdx = this.state.hierarchyAssignments.findIndex(a => a.filePath === filePath)
      if (existingIdx >= 0) {
        this.state.hierarchyAssignments[existingIdx] = { filePath, hierarchyPath }
      }
      else {
        this.state.hierarchyAssignments.push({ filePath, hierarchyPath })
      }
      processed++
    }

    if (notFound.length > 0) {
      throw new Error(`File not found: ${notFound.join(', ')}. Use rpg://encoding/hierarchy to see valid file paths.`)
    }

    // Build hierarchy nodes in the graph
    const warnings: string[] = []
    if (this.state.rpg) {
      await this.buildHierarchyNodes(assignments)

      // Artifact Grounding: LCA-based metadata propagation (논문 Phase 3a)
      try {
        const grounder = new ArtifactGrounder(this.state.rpg)
        await grounder.ground()
      }
      catch (error) {
        const msg = `Artifact grounding failed: ${error instanceof Error ? error.message : String(error)}`
        console.warn(`[InteractiveEncoder] ${msg}`)
        warnings.push(msg)
      }
    }

    await this.persistGraph()

    const routing = this.state.pendingRouting.length
    const nextAction = routing > 0
      ? `${routing} entities need routing. Read rpg://encoding/routing/0.`
      : 'Done. Use rpg_search to verify the RPG.'

    return {
      success: true,
      entitiesProcessed: processed,
      coveragePercent: this.state.getCoveragePercent(),
      ...(warnings.length > 0 && { warnings }),
      nextAction,
    }
  }

  /**
   * Get routing candidates with hierarchy context
   */
  getRoutingBatch(batchIndex: number): string {
    const batchSize = 10
    const candidates = this.state.pendingRouting
    const start = batchIndex * batchSize
    const end = Math.min(start + batchSize, candidates.length)
    const totalBatches = Math.ceil(candidates.length / batchSize)

    if (candidates.length === 0) {
      return 'No entities pending routing.'
    }

    if (start >= candidates.length) {
      return `Batch ${batchIndex} is out of range. Total batches: ${totalBatches}.`
    }

    const batch = candidates.slice(start, end)
    const parts: string[] = []

    if (batchIndex === 0) {
      parts.push(ROUTING_INSTRUCTIONS)
      parts.push('')
    }

    parts.push(`## Routing Batch ${batchIndex} of ${totalBatches}`)
    parts.push(`Graph revision: ${this.state.getGraphRevision()}`)
    parts.push('')

    for (const candidate of batch) {
      parts.push(`### ${candidate.entityId}`)
      parts.push(`- Reason: ${candidate.reason}`)
      parts.push(`- Current path: ${candidate.currentPath}`)
      parts.push(`- Features: ${candidate.features.join(', ')}`)
      parts.push('')
    }

    // Include hierarchy context
    if (this.state.hierarchyAssignments.length > 0) {
      parts.push('## Current Hierarchy')
      const pathGroups = new Map<string, string[]>()
      for (const { filePath, hierarchyPath } of this.state.hierarchyAssignments) {
        const existing = pathGroups.get(hierarchyPath) ?? []
        existing.push(filePath)
        pathGroups.set(hierarchyPath, existing)
      }
      for (const [hPath, files] of pathGroups) {
        parts.push(`- ${hPath}: ${files.join(', ')}`)
      }
    }

    if (batchIndex + 1 < totalBatches) {
      parts.push(`\n## NEXT: Read rpg://encoding/routing/${batchIndex + 1} for the next batch`)
    }

    return parts.join('\n')
  }

  /**
   * Apply routing decisions with revision validation
   */
  async submitRouting(decisionsJson: string, revision: string): Promise<SubmitResult> {
    // Validate revision
    const currentRevision = this.state.getGraphRevision()
    if (revision !== currentRevision) {
      throw new Error(
        `Stale revision: expected "${currentRevision}", got "${revision}". `
        + `Re-read rpg://encoding/routing/0 for fresh data.`,
      )
    }

    let decisions: Array<{ entityId: string, decision: 'keep' | 'move' | 'split', targetPath?: string }>
    try {
      decisions = JSON.parse(decisionsJson)
    }
    catch {
      throw new Error('Invalid JSON. Expected: [{"entityId": "...", "decision": "keep|move|split", "targetPath?": "..."}, ...]')
    }

    // Validate all entity IDs exist in pending routing before mutating state
    const notFound: string[] = []
    for (const { entityId } of decisions) {
      if (!this.state.pendingRouting.find(p => p.entityId === entityId)) {
        notFound.push(entityId)
      }
    }
    if (notFound.length > 0) {
      throw new Error(
        `Entity not found in pending routing: ${notFound.join(', ')}. `
        + `Read rpg://encoding/routing/0 for current candidates.`,
      )
    }

    let processed = 0

    for (const { entityId, decision, targetPath } of decisions) {
      const pending = this.state.pendingRouting.find(p => p.entityId === entityId)!

      if (decision === 'move' && targetPath) {
        // Upsert hierarchy assignment
        const existing = this.state.hierarchyAssignments.findIndex(
          a => a.filePath === pending.currentPath,
        )
        if (existing >= 0) {
          this.state.hierarchyAssignments[existing] = {
            filePath: pending.currentPath,
            hierarchyPath: targetPath,
          }
        }
        else {
          this.state.hierarchyAssignments.push({
            filePath: pending.currentPath,
            hierarchyPath: targetPath,
          })
        }
      }

      // Remove from pending
      this.state.pendingRouting = this.state.pendingRouting.filter(
        p => p.entityId !== entityId,
      )
      processed++
    }

    await this.persistGraph()

    const remaining = this.state.pendingRouting.length
    const nextAction = remaining > 0
      ? `${remaining} entities still pending. Read rpg://encoding/routing/0.`
      : 'All routing complete. Use rpg_search to verify the RPG.'

    return {
      success: true,
      entitiesProcessed: processed,
      coveragePercent: this.state.getCoveragePercent(),
      nextAction,
    }
  }

  // ==================== Private Helpers ====================

  private findNextUnliftedBatch(): number | null {
    for (let i = 0; i < this.state.batchBoundaries.length; i++) {
      const entities = this.state.getBatchEntities(i)
      const hasUnlifted = entities.some(e => !this.state.liftedFeatures.has(e.id))
      if (hasUnlifted)
        return i
    }
    return null
  }

  private async buildHierarchyNodes(assignments: Record<string, string>): Promise<void> {
    const rpg = this.state.rpg!
    const createdNodes = new Set<string>()

    for (const [filePath, hierarchyPath] of Object.entries(assignments)) {
      const segments = hierarchyPath.split('/')
      if (segments.length < 1)
        continue

      const leafId = await this.ensureHierarchyPath(rpg, segments, createdNodes)
      await this.linkFileToHierarchy(rpg, filePath, leafId)
    }
  }

  private async ensureHierarchyPath(
    rpg: RepositoryPlanningGraph,
    segments: string[],
    createdNodes: Set<string>,
  ): Promise<string> {
    let parentId: string | null = null

    for (let level = 0; level < segments.length; level++) {
      const nodeId = segments.slice(0, level + 1).join('/')
      if (!createdNodes.has(nodeId) && !(await rpg.hasNode(nodeId))) {
        await rpg.addHighLevelNode({
          id: nodeId,
          feature: { description: segments[level] ?? nodeId, keywords: [] },
          directoryPath: nodeId,
        })
        createdNodes.add(nodeId)
        if (parentId) {
          await rpg.addFunctionalEdge({ source: parentId, target: nodeId })
        }
      }
      parentId = nodeId
    }

    return parentId!
  }

  private async linkFileToHierarchy(
    rpg: RepositoryPlanningGraph,
    filePath: string,
    parentId: string,
  ): Promise<void> {
    const fileEntity = this.state.entities.find(
      e => e.filePath === filePath && e.entityType === 'file',
    )
    if (!fileEntity)
      return

    try {
      await rpg.addFunctionalEdge({ source: parentId, target: fileEntity.id })
    }
    catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (!msg.includes('already exists') && !msg.includes('duplicate') && !msg.includes('UNIQUE')) {
        throw error
      }
    }
  }

  private async persistGraph(): Promise<void> {
    if (!this.state.rpg || !this.state.repoPath) {
      console.warn('[InteractiveEncoder] Cannot persist graph: RPG or repoPath not set')
      return
    }

    const outputDir = path.join(this.state.repoPath, '.rpg')
    await mkdir(outputDir, { recursive: true })

    const json = await this.state.rpg.toJSON()
    await writeFile(path.join(outputDir, 'graph.json'), json)
  }
}

/**
 * Compute Jaccard distance between two sets.
 * Returns 0 when identical, 1 when completely disjoint.
 */
export function jaccardDistance(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0)
    return 0
  let intersection = 0
  for (const item of a) {
    if (b.has(item))
      intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : 1 - intersection / union
}
