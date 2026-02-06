import type { RepositoryPlanningGraph } from '../../graph/rpg'
import type { OperationContext } from './operations'
import type { EvolutionOptions, EvolutionResult } from './types'
import path from 'node:path'
import { ASTParser } from '../../utils/ast'
import { LLMClient } from '../../utils/llm'
import { SemanticCache } from '../cache'
import { SemanticExtractor } from '../semantic'
import { DiffParser } from './diff-parser'
import { deleteNode, insertNode, processModification } from './operations'
import { SemanticRouter } from './semantic-router'
import { DEFAULT_DRIFT_THRESHOLD } from './types'

/**
 * RPGEvolver — orchestrates incremental RPG updates from git commits.
 *
 * Implements the Evolution pipeline from RPG-Encoder §4:
 * 1. ParseUnitDiff: Git diff → entity-level changes (U+, U-, U~)
 * 2. Schedule: Delete → Modify → Insert (paper §A.2.1)
 * 3. Execute atomic operations
 * 4. Return statistics
 */
export class RPGEvolver {
  private rpg: RepositoryPlanningGraph
  private options: EvolutionOptions
  private diffParser: DiffParser
  private semanticExtractor: SemanticExtractor
  private semanticRouter: SemanticRouter
  private cache: SemanticCache
  private astParser: ASTParser

  constructor(rpg: RepositoryPlanningGraph, options: EvolutionOptions) {
    this.rpg = rpg
    this.options = options

    this.astParser = new ASTParser()
    this.diffParser = new DiffParser(options.repoPath, this.astParser)

    this.semanticExtractor = new SemanticExtractor(options.semantic)
    this.cache = new SemanticCache({
      cacheDir: path.join(options.repoPath, '.please', 'cache'),
      ...options.cache,
    })

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

    // 2. Process deletions first (structural hygiene — paper scheduling)
    for (const entity of diffResult.deletions) {
      const pruned = await deleteNode(this.rpg, entity.id)
      result.deleted++
      result.prunedNodes += pruned
    }

    // 3. Process modifications (may trigger delete + insert for drift)
    for (const mod of diffResult.modifications) {
      const modResult = await processModification(this.rpg, mod.old, mod.new, ctx, driftThreshold)

      if (modResult.rerouted) {
        result.rerouted++
      }
      else {
        result.modified++
      }
      result.prunedNodes += modResult.prunedNodes
    }

    // 4. Process insertions last (new entities route into clean hierarchy)
    for (const entity of diffResult.insertions) {
      await insertNode(this.rpg, entity, ctx)
      result.inserted++
    }

    // 5. Save semantic cache
    await this.cache.save()

    // 6. Collect statistics
    result.llmCalls = this.semanticRouter.getLLMCalls()
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
      apiKey: this.options.semantic?.apiKey,
      maxTokens: this.options.semantic?.maxTokens,
    })
  }

  /**
   * Detect available LLM provider from environment
   */
  private detectProvider(): 'google' | 'anthropic' | 'openai' | null {
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
