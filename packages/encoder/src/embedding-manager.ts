import type { EmbeddingConfig, SerializedEmbeddings } from '@pleaseai/rpg-graph/embeddings'
import type { RepositoryPlanningGraph } from '@pleaseai/rpg-graph/rpg'
import type { Embedding } from './embedding'
import { float32ToBase64Float16 } from '@pleaseai/rpg-graph/embeddings'
import { createLogger } from '@pleaseai/rpg-utils/logger'

const log = createLogger('EmbeddingManager')

/** Default text template matching MCP server indexing */
const DEFAULT_TEXT_TEMPLATE = '{description} {keywords} {path}'

/**
 * EmbeddingManager — generates and manages serialized embeddings for git storage.
 *
 * Produces SerializedEmbeddings with base64 float16 vectors that can be
 * committed to git as `.rpg/embeddings.json`.
 */
export class EmbeddingManager {
  private readonly provider: Embedding
  private readonly config: EmbeddingConfig

  constructor(provider: Embedding, config: Partial<EmbeddingConfig> & { provider: string, model: string }) {
    this.provider = provider
    this.config = {
      provider: config.provider,
      model: config.model,
      dimension: config.dimension ?? provider.getDimension(),
      space: config.space,
      textTemplate: config.textTemplate ?? DEFAULT_TEXT_TEMPLATE,
    }
  }

  /**
   * Generate embeddings for all nodes in an RPG.
   *
   * @param rpg - The RPG to index
   * @param commit - HEAD SHA to stamp
   * @returns Serialized embeddings ready for JSON output
   */
  async indexAll(rpg: RepositoryPlanningGraph, commit: string): Promise<SerializedEmbeddings> {
    const nodes = await rpg.getNodes()
    log.start(`Generating embeddings for ${nodes.length} nodes...`)

    const texts = nodes.map(node => this.buildText(node))
    const results = await this.provider.embedBatch(texts)

    // Update dimension from actual results
    if (results.length > 0 && results[0]!.dimension > 0) {
      this.config.dimension = results[0]!.dimension
    }

    const embeddings = nodes.map((node, i) => ({
      id: node.id,
      vector: float32ToBase64Float16(results[i]!.vector),
    }))

    log.success(`Generated ${embeddings.length} embeddings (${this.config.dimension}d)`)

    return {
      version: '1.0.0',
      config: { ...this.config },
      commit,
      embeddings,
    }
  }

  /**
   * Incrementally update embeddings after an evolve operation.
   *
   * @param existing - Current serialized embeddings
   * @param rpg - Updated RPG (after evolve)
   * @param changes - Node IDs that were added, removed, or modified
   * @param changes.added - Node IDs that were added
   * @param changes.removed - Node IDs that were removed
   * @param changes.modified - Node IDs that were modified
   * @param commit - New HEAD SHA
   * @returns Updated serialized embeddings
   */
  async applyChanges(
    existing: SerializedEmbeddings,
    rpg: RepositoryPlanningGraph,
    changes: { added: string[], removed: string[], modified: string[] },
    commit: string,
  ): Promise<SerializedEmbeddings> {
    const removedSet = new Set(changes.removed)
    const modifiedSet = new Set(changes.modified)
    const needsEmbedding = [...changes.added, ...changes.modified]

    log.start(
      `Incremental embedding update: +${changes.added.length} -${changes.removed.length} ~${changes.modified.length}`,
    )

    // Remove deleted and modified entries (modified will be re-added)
    const kept = existing.embeddings.filter(
      e => !removedSet.has(e.id) && !modifiedSet.has(e.id),
    )

    // Generate embeddings for new and modified nodes
    if (needsEmbedding.length > 0) {
      const texts: string[] = []
      const validIds: string[] = []

      for (const id of needsEmbedding) {
        const node = await rpg.getNode(id)
        if (node) {
          texts.push(this.buildText(node))
          validIds.push(id)
        }
        else {
          log.warn(`Node ${id} not found in RPG, skipping embedding`)
        }
      }

      if (texts.length > 0) {
        const results = await this.provider.embedBatch(texts)
        for (let i = 0; i < validIds.length; i++) {
          kept.push({
            id: validIds[i]!,
            vector: float32ToBase64Float16(results[i]!.vector),
          })
        }
      }
    }

    log.success(`Embedding update complete: ${kept.length} total entries`)

    return {
      version: '1.0.0',
      config: existing.config,
      commit,
      embeddings: kept,
    }
  }

  /**
   * Build the text string for a node using the configured template.
   */
  private buildText(node: { feature: { description: string, keywords?: string[] }, metadata?: { path?: string } }): string {
    return this.config.textTemplate
      .replace('{description}', node.feature.description)
      .replace('{keywords}', (node.feature.keywords ?? []).join(' '))
      .replace('{path}', node.metadata?.path ?? '')
  }
}
