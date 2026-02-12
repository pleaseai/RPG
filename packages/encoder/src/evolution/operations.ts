import type { SemanticFeature } from '@pleaseai/rpg-graph/node'
import type { RepositoryPlanningGraph } from '@pleaseai/rpg-graph/rpg'
import type { ASTParser } from '@pleaseai/rpg-utils/ast'
import type { Embedding } from '../embedding'
import type { SemanticExtractor } from '../semantic'
import type { SemanticRouter } from './semantic-router'
import type { ChangedEntity } from './types'
import path from 'node:path'
import { cosineSimilarity } from './semantic-router'
import { DEFAULT_DRIFT_THRESHOLD } from './types'

/**
 * DeleteNode — Algorithm 2 from RPG-Encoder §3 (Appendix A.2, deletion.tex)
 *
 * 1. Remove the target node (CASCADE deletes incident edges per GraphStore contract)
 * 2. PruneOrphans: recursively remove empty ancestor HighLevelNodes
 *
 * Returns the number of pruned ancestor nodes.
 */
export async function deleteNode(rpg: RepositoryPlanningGraph, entityId: string): Promise<number> {
  const node = await rpg.getNode(entityId)
  if (!node) {
    return 0 // Idempotent: already deleted
  }

  // Remember parent before removal
  const parent = await rpg.getParent(entityId)

  // Remove node (CASCADE deletes all incident edges)
  await rpg.removeNode(entityId)

  // Prune orphan ancestors
  if (parent) {
    return pruneOrphans(rpg, parent.id)
  }

  return 0
}

/**
 * PruneOrphans — recursive bottom-up removal of empty ancestors
 *
 * If a parent node has no remaining children after deletion,
 * remove it and recurse to its parent.
 */
async function pruneOrphans(rpg: RepositoryPlanningGraph, nodeId: string): Promise<number> {
  const node = await rpg.getNode(nodeId)
  if (!node) {
    return 0
  }

  // Check if node still has children
  const children = await rpg.getChildren(nodeId)
  if (children.length > 0) {
    return 0 // Has children, stop pruning
  }

  // Node is empty — remember parent, then remove
  const parent = await rpg.getParent(nodeId)

  // Guard against concurrent removal during the same evolution pass
  if (!(await rpg.hasNode(nodeId))) {
    return 0
  }
  await rpg.removeNode(nodeId)

  // Recurse to parent
  if (parent) {
    return 1 + (await pruneOrphans(rpg, parent.id))
  }

  return 1
}

/**
 * Context object passed to insert/modify operations
 */
export interface OperationContext {
  semanticExtractor: SemanticExtractor
  semanticRouter: SemanticRouter
  embedding?: Embedding
  astParser?: ASTParser
  repoPath: string
  includeSource?: boolean
}

/**
 * InsertNode — Algorithm 4 from RPG-Encoder §3 (Appendix A.2, insertion.tex)
 *
 * Steps 1-4 implement Algorithm 4 from the paper:
 * 1. Extract semantic feature via SemanticExtractor
 * 2. Find best parent via FindBestParent (SemanticRouter)
 * 3. Create LowLevelNode
 * 4. Create FunctionalEdge from parent to new node
 *
 * Step 5 is an implementation addition for dependency maintenance:
 * 5. Inject dependency edges for imports
 */
export async function insertNode(
  rpg: RepositoryPlanningGraph,
  entity: ChangedEntity,
  ctx: OperationContext,
): Promise<void> {
  // 1. Extract semantic feature
  const feature = await ctx.semanticExtractor.extract({
    type: entity.entityType,
    name: entity.entityName,
    filePath: entity.filePath,
    sourceCode: entity.sourceCode,
    parent: entity.qualifiedName.includes('.')
      ? entity.qualifiedName.split('.').slice(0, -1).join('.')
      : undefined,
  })

  // 2. Find best parent via semantic routing
  const parentId = await ctx.semanticRouter.findBestParent(feature.description)

  // 3. Create LowLevelNode
  await rpg.addLowLevelNode({
    id: entity.id,
    feature,
    metadata: {
      entityType: entity.entityType,
      path: entity.filePath,
      startLine: entity.startLine,
      endLine: entity.endLine,
      qualifiedName: entity.qualifiedName,
    },
    sourceCode: ctx.includeSource ? entity.sourceCode : undefined,
  })

  // 4. Create FunctionalEdge from parent to new node
  if (parentId) {
    await rpg.addFunctionalEdge({ source: parentId, target: entity.id })
  }

  // 5. Inject dependency edges (file-level only)
  if (entity.entityType === 'file' && ctx.astParser) {
    await injectDependencyEdges(rpg, entity, ctx)
  }
}

/**
 * Inject dependency edges for a new file entity by parsing its imports
 */
async function injectDependencyEdges(
  rpg: RepositoryPlanningGraph,
  entity: ChangedEntity,
  ctx: OperationContext,
): Promise<void> {
  if (!entity.sourceCode || !ctx.astParser) {
    return
  }

  const language = ctx.astParser.detectLanguage(entity.filePath)
  if (language === 'unknown') {
    return
  }

  const parseResult = await ctx.astParser.parse(entity.sourceCode, language)

  for (const importInfo of parseResult.imports) {
    const targetPath = resolveImportPath(entity.filePath, importInfo.module)
    if (!targetPath) {
      continue
    }

    // Look for the target file node in the RPG
    const targetId = `${targetPath}:file:${targetPath}`
    if ((await rpg.hasNode(targetId)) && targetId !== entity.id) {
      try {
        await rpg.addDependencyEdge({
          source: entity.id,
          target: targetId,
          dependencyType: 'import',
        })
      }
      catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        // Duplicate edge is expected (skip), but other errors should surface
        if (!msg.includes('already exists') && !msg.includes('not found')) {
          console.warn(
            `[evolution] Failed to add dependency edge ${entity.id} → ${targetId}: ${msg}`,
          )
        }
      }
    }
  }
}

/**
 * Resolve import module path to actual file path.
 * Tries direct file extensions first, then index files in directories.
 */
function resolveImportPath(sourceFile: string, modulePath: string): string | null {
  if (!modulePath.startsWith('.') && !modulePath.startsWith('/')) {
    return null // External module
  }

  const sourceDir = path.dirname(sourceFile)
  const resolved = path.normalize(path.join(sourceDir, modulePath))
  const normalize = (p: string) => p.replace(/\\/g, '/')

  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '']

  // Try direct file match (e.g., ./utils → ./utils.ts)
  for (const ext of extensions) {
    const candidate = normalize(resolved + ext)
    if (!candidate.startsWith('/')) {
      return candidate
    }
  }

  // Try index file resolution (e.g., ./utils → ./utils/index.ts)
  const indexExtensions = ['.ts', '.tsx', '.js', '.jsx']
  for (const ext of indexExtensions) {
    const candidate = normalize(path.join(resolved, `index${ext}`))
    if (!candidate.startsWith('/')) {
      return candidate
    }
  }

  return normalize(resolved)
}

/**
 * ProcessModification — per-entity re-route logic from Algorithm 3,
 * RPG-Encoder §3 (Appendix A.2, modified.tex, lines 19-26)
 *
 * For a modified entity:
 * 1. Re-extract semantic feature
 * 2. Compute semantic drift (cosine distance, range [0,1] where 0=identical, 1=maximum drift)
 * 3. If drift > threshold: delete + insert (re-route)
 * 4. Else: in-place update
 *
 * Returns: { rerouted: boolean, prunedNodes: number }
 */
export async function processModification(
  rpg: RepositoryPlanningGraph,
  oldEntity: ChangedEntity,
  newEntity: ChangedEntity,
  ctx: OperationContext,
  driftThreshold: number = DEFAULT_DRIFT_THRESHOLD,
): Promise<{ rerouted: boolean, prunedNodes: number }> {
  // Find the existing node (may have line-number-based ID from initial encode)
  const existingNodeId = await findMatchingNode(rpg, oldEntity)
  if (!existingNodeId) {
    // Node not in graph — treat as insertion
    await insertNode(rpg, newEntity, ctx)
    return { rerouted: false, prunedNodes: 0 }
  }

  // 1. Re-extract semantic feature for new version
  const newFeature = await ctx.semanticExtractor.extract({
    type: newEntity.entityType,
    name: newEntity.entityName,
    filePath: newEntity.filePath,
    sourceCode: newEntity.sourceCode,
    parent: newEntity.qualifiedName.includes('.')
      ? newEntity.qualifiedName.split('.').slice(0, -1).join('.')
      : undefined,
  })

  // 2. Compute semantic drift
  const existingNode = await rpg.getNode(existingNodeId)
  const oldFeature = existingNode?.feature
  const drift = await computeDrift(oldFeature, newFeature, ctx.embedding)

  // 3. If significant drift: delete + insert (re-route to correct location)
  if (drift > driftThreshold) {
    const prunedNodes = await deleteNode(rpg, existingNodeId)
    try {
      await insertNode(rpg, newEntity, ctx)
    }
    catch (error) {
      console.error(
        `[evolution] Node "${existingNodeId}" was deleted during re-route but re-insert failed. Graph may be inconsistent.`,
        error,
      )
      throw error
    }
    return { rerouted: true, prunedNodes }
  }

  // 4. In-place update (no re-routing needed)
  await rpg.updateNode(existingNodeId, {
    feature: newFeature,
    metadata: {
      entityType: newEntity.entityType,
      path: newEntity.filePath,
      startLine: newEntity.startLine,
      endLine: newEntity.endLine,
      qualifiedName: newEntity.qualifiedName,
    },
  })

  return { rerouted: false, prunedNodes: 0 }
}

/**
 * Compute semantic drift between old and new features.
 *
 * Primary: cosine distance of embeddings (1 - cosine_similarity)
 * Fallback: keyword Jaccard distance (1 - |intersection| / |union|)
 */
async function computeDrift(
  oldFeature: SemanticFeature | undefined,
  newFeature: SemanticFeature,
  embedding?: Embedding,
): Promise<number> {
  if (!oldFeature) {
    return 1.0 // No old feature = maximum drift
  }

  // Primary: embedding-based cosine distance
  if (embedding) {
    try {
      const [oldEmbed, newEmbed] = await Promise.all([
        embedding.embed(oldFeature.description),
        embedding.embed(newFeature.description),
      ])
      return 1 - cosineSimilarity(oldEmbed.vector, newEmbed.vector)
    }
    catch (error) {
      console.warn(
        '[computeDrift] Embedding failed, falling back to keyword-based drift:',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  // Fallback: keyword Jaccard distance
  const oldKeywords = new Set(oldFeature.keywords ?? [])
  const newKeywords = new Set(newFeature.keywords ?? [])

  if (oldKeywords.size === 0 && newKeywords.size === 0) {
    // No keywords — compare descriptions as token sets
    return descriptionDrift(oldFeature.description, newFeature.description)
  }

  const intersection = new Set([...oldKeywords].filter(k => newKeywords.has(k)))
  const union = new Set([...oldKeywords, ...newKeywords])

  if (union.size === 0) {
    return 0
  }

  return 1 - intersection.size / union.size
}

/**
 * Simple description drift: token-level Jaccard distance
 */
function descriptionDrift(oldDesc: string, newDesc: string): number {
  const tokenize = (s: string) => new Set(s.toLowerCase().split(/\s+/).filter(Boolean))
  const oldTokens = tokenize(oldDesc)
  const newTokens = tokenize(newDesc)

  const intersection = new Set([...oldTokens].filter(t => newTokens.has(t)))
  const union = new Set([...oldTokens, ...newTokens])

  if (union.size === 0) {
    return 0
  }

  return 1 - intersection.size / union.size
}

/**
 * Find a node in the RPG that matches a ChangedEntity.
 *
 * Tries exact match first, then falls back to ID prefix match
 * (to handle line number differences in existing node IDs).
 */
export async function findMatchingNode(
  rpg: RepositoryPlanningGraph,
  entity: ChangedEntity,
): Promise<string | null> {
  // Try exact match (evolution-style ID without line numbers)
  if (await rpg.hasNode(entity.id)) {
    return entity.id
  }

  // Fallback: match by ID prefix to handle encoder-style IDs with line numbers
  // (e.g., "file.ts:function:foo:10" matches evolution "file.ts:function:foo")
  const basePattern = `${entity.filePath}:${entity.entityType}:${entity.entityName}`
  const nodes = await rpg.getLowLevelNodes()
  for (const node of nodes) {
    if (node.id.startsWith(basePattern)) {
      return node.id
    }
  }

  return null
}
