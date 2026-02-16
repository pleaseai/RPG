import type { RepositoryPlanningGraph } from '@pleaseai/rpg-graph/rpg'
import type { LLMProvider } from '@pleaseai/rpg-utils/llm'
import type { OperationContext } from './operations'
import type { EvolutionOptions, EvolutionResult } from './types'
import { ASTParser } from '@pleaseai/rpg-utils/ast'
import { LLMClient } from '@pleaseai/rpg-utils/llm'
import { SemanticExtractor } from '../semantic'
import { DiffParser } from './diff-parser'
import { deleteNode, insertNode, processModification } from './operations'
import { SemanticRouter } from './semantic-router'
import { DEFAULT_DRIFT_THRESHOLD } from './types'

/**
 * RPGEvolver — orchestrates incremental RPG updates from git commits.
 *
 * Implements the Evolution pipeline from RPG-Encoder §3 (Appendix A.2):
 * 1. ParseUnitDiff: Git diff → entity-level changes (U+, U-, U~)
 * 2. Schedule: Delete → Modify → Insert (Appendix A.2.1)
 * 3. Execute atomic operations
 * 4. Return statistics
 */
export class RPGEvolver {
  private readonly rpg: RepositoryPlanningGraph
  private readonly options: EvolutionOptions
  private readonly diffParser: DiffParser
  private readonly semanticExtractor: SemanticExtractor
  private readonly semanticRouter: SemanticRouter
  private readonly astParser: ASTParser

  constructor(rpg: RepositoryPlanningGraph, options: EvolutionOptions) {
    this.rpg = rpg
    this.options = options

    this.astParser = new ASTParser()
    this.diffParser = new DiffParser(options.repoPath, this.astParser)

    this.semanticExtractor = new SemanticExtractor(options.semantic)

    // Initialize LLM client if enabled
    const llmClient = this.createLLMClient()

    this.semanticRouter = new SemanticRouter(rpg, { llmClient })
  }

  /**
   * Execute the evolution pipeline
   */
  async evolve(): Promise<EvolutionResult> {
    const startTime = Date.now()
    const result: EvolutionResult = {
      inserted: 0,
      deleted: 0,
      modified: 0,
      rerouted: 0,
      prunedNodes: 0,
      duration: 0,
      llmCalls: 0,
      errors: [],
    }

    // 1. Parse git diff → DiffResult
    const diffResult = await this.diffParser.parse(this.options.commitRange)

    // Build operation context
    const ctx: OperationContext = {
      semanticExtractor: this.semanticExtractor,
      semanticRouter: this.semanticRouter,
      astParser: this.astParser,
      repoPath: this.options.repoPath,
      includeSource: this.options.includeSource,
    }

    const driftThreshold = this.options.driftThreshold ?? DEFAULT_DRIFT_THRESHOLD

    const errors: Array<{ entity: string, phase: string, error: string }> = []

    // Track changed node IDs for incremental embedding updates
    const embeddingChanges = {
      added: [] as string[],
      removed: [] as string[],
      modified: [] as string[],
    }

    // 2. Process deletions first (structural hygiene — paper scheduling)
    for (const entity of diffResult.deletions) {
      try {
        const pruned = await deleteNode(this.rpg, entity.id)
        result.deleted++
        result.prunedNodes += pruned
        embeddingChanges.removed.push(entity.id)
      }
      catch (error) {
        errors.push({
          entity: entity.id,
          phase: 'deletion',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // 3. Process modifications (may trigger delete + insert for drift)
    for (const mod of diffResult.modifications) {
      try {
        const modResult = await processModification(this.rpg, mod.old, mod.new, ctx, driftThreshold)

        if (modResult.rerouted) {
          result.rerouted++
          // Rerouted = old deleted + new inserted
          embeddingChanges.removed.push(mod.old.id)
          embeddingChanges.added.push(mod.new.id)
        }
        else {
          result.modified++
          embeddingChanges.modified.push(mod.new.id)
        }
        result.prunedNodes += modResult.prunedNodes
      }
      catch (error) {
        errors.push({
          entity: mod.old.id,
          phase: 'modification',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // 4. Process insertions last (new entities route into clean hierarchy)
    for (const entity of diffResult.insertions) {
      try {
        await insertNode(this.rpg, entity, ctx)
        result.inserted++
        embeddingChanges.added.push(entity.id)
      }
      catch (error) {
        errors.push({
          entity: entity.id,
          phase: 'insertion',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // 5. Collect statistics
    result.llmCalls = this.semanticRouter.getLLMCalls()
    result.errors = errors
    result.embeddingChanges = embeddingChanges
    result.duration = Date.now() - startTime

    return result
  }

  /**
   * Create LLM client if enabled and provider is available
   */
  private createLLMClient(): LLMClient | undefined {
    const useLLM = this.options.useLLM ?? this.options.semantic?.useLLM ?? true
    if (!useLLM) {
      return undefined
    }

    const provider = this.options.semantic?.provider ?? this.detectProvider()
    if (!provider) {
      return undefined
    }

    return new LLMClient({
      provider,
      model: this.options.semantic?.model,
      apiKey: this.options.semantic?.apiKey,
      maxTokens: this.options.semantic?.maxTokens,
      claudeCodeSettings: this.options.semantic?.claudeCodeSettings,
      codexSettings: this.options.semantic?.codexSettings,
    })
  }

  /**
   * Detect available LLM provider from environment
   */
  private detectProvider(): LLMProvider | null {
    if (process.env.GOOGLE_API_KEY) {
      return 'google'
    }
    if (process.env.ANTHROPIC_API_KEY) {
      return 'anthropic'
    }
    if (process.env.OPENAI_API_KEY) {
      return 'openai'
    }
    return null
  }
}
