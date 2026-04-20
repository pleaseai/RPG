import type { ClaudeCodeSettings, CodexCliSettings, GoogleLanguageModelOptions, LLMProvider } from '@pleaseai/soop-utils/llm'
import { SemanticFeatureSchema as NodeSemanticFeatureSchema } from '@pleaseai/soop-graph/node'
import { LLMClient } from '@pleaseai/soop-utils/llm'
import { createLogger } from '@pleaseai/soop-utils/logger'
import { Memory } from '@pleaseai/soop-utils/memory'
import { z } from 'zod/v4'
import {
  buildBatchClassPrompt,
  buildBatchFileSummaryPrompt,
  buildBatchFunctionPrompt,
  buildBatchTestClassPrompt,
  buildBatchTestFunctionPrompt,
} from './reorganization/prompts'
import { estimateEntityTokens } from './token-counter'

const log = createLogger('SemanticExtractor')

/**
 * Build a composite key from a file path and entity name to prevent name collisions
 * across files when multiple files are batched into a single LLM prompt.
 */
function compositeKey(filePath: string, name: string): string {
  return `${filePath}::${name}`
}

/**
 * Options for semantic extraction
 */
export interface SemanticOptions {
  /** LLM provider to use */
  provider?: LLMProvider
  /** Model name (e.g., 'gpt-5.2', 'haiku', 'gemini-3.1-flash-lite-preview') */
  model?: string
  /** API key (defaults to environment variable) */
  apiKey?: string
  /** Whether to use LLM for semantic extraction (if false, uses heuristic) */
  useLLM?: boolean
  /** Maximum tokens per request */
  maxTokens?: number
  /** Claude Code provider settings (only used when provider is 'claude-code') */
  claudeCodeSettings?: ClaudeCodeSettings
  /** Codex CLI provider settings (only used when provider is 'codex') */
  codexSettings?: CodexCliSettings
  /** Google provider settings, e.g. thinkingConfig (only used when provider is 'google') */
  googleSettings?: GoogleLanguageModelOptions
  /** Minimum tokens per batch - if last batch is below this, merge with previous (default: 10000) */
  minBatchTokens?: number
  /** Maximum tokens per batch - group entities until this limit (default: 50000) */
  maxBatchTokens?: number
  /** Maximum parse iterations for retry on LLM extraction failure (default: 3) */
  maxParseIterations?: number
  /** Repository name (for LLM batch prompts) */
  repoName?: string
  /** Repository overview/info (for richer LLM prompts) */
  repoInfo?: string
  /** Maximum concurrent batch LLM requests (default: 4) */
  maxConcurrentBatches?: number
  /** Repository directory skeleton (for richer batch prompts) */
  skeleton?: string
}

/**
 * Zod schema for semantic feature with required keywords (extends graph/node schema)
 */
export const SemanticFeatureSchema = NodeSemanticFeatureSchema.extend({
  keywords: z.array(z.string()),
})

/**
 * Semantic feature generated for an entity
 */
export type SemanticFeature = z.infer<typeof SemanticFeatureSchema>

/**
 * Input for semantic extraction
 */
export interface EntityInput {
  /** Entity type (function, class, method, file) */
  type: string
  /** Entity name */
  name: string
  /** Source code (optional, for LLM analysis) */
  sourceCode?: string
  /** File path */
  filePath: string
  /** Parent entity name (for methods) */
  parent?: string
  /** Documentation/comments */
  documentation?: string
}

/**
 * Sentinel key used in class batch result maps to store the synthesized class-level feature.
 * Must match between extractClassBatch (creation) and processClassGroupBatches (consumption).
 */
const CLASS_FEATURE_KEY = '__class__' as const

/**
 * A class entity with its child methods for batched processing
 */
export interface ClassGroup {
  classEntity: EntityInput
  methodEntities: EntityInput[]
}

/**
 * Run tasks with a concurrency limit
 */
async function runConcurrent<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = []
  let i = 0
  async function worker() {
    while (i < tasks.length) {
      const idx = i++
      results[idx] = await tasks[idx]!()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

/**
 * Detect whether a file path belongs to a test file.
 * Used to route test entities to test-specific prompts (Gap 3).
 */
function isTestFile(filePath: string): boolean {
  const lower = filePath.toLowerCase()
  return (
    lower.includes('.test.')
    || lower.includes('.spec.')
    || lower.includes('__tests__')
    || lower.includes('/test/')
    || lower.includes('/tests/')
    || lower.startsWith('test/')
    || lower.startsWith('tests/')
  )
}

/**
 * Semantic extractor using LLM or heuristics
 */
export class SemanticExtractor {
  private readonly llmClient?: LLMClient
  private options: SemanticOptions
  private readonly warnings: string[] = []

  constructor(options: SemanticOptions = {}) {
    const providerWasExplicit = options.provider !== undefined
    this.options = {
      useLLM: true,
      provider: 'google',
      maxTokens: 8192,
      minBatchTokens: 10000,
      maxBatchTokens: 50000,
      maxParseIterations: 3,
      maxConcurrentBatches: 4,
      ...options,
    }

    if (this.options.useLLM && this.options.provider === 'google') {
      // Default to minimal thinking for Phase 1 (structured JSON extraction — deep reasoning not needed)
      if (!this.options.googleSettings) {
        this.options.googleSettings = { thinkingConfig: { thinkingLevel: 'minimal' } }
      }
      const key = this.options.apiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY
      if (!key) {
        if (providerWasExplicit) {
          throw new Error(
            'SemanticExtractor: provider is "google" but GOOGLE_GENERATIVE_AI_API_KEY is not set. '
            + 'Set GOOGLE_GENERATIVE_AI_API_KEY or pass apiKey explicitly.',
          )
        }
        log.warn(
          'GOOGLE_GENERATIVE_AI_API_KEY is not set — falling back to heuristic mode. '
          + 'Set GOOGLE_GENERATIVE_AI_API_KEY or pass provider/apiKey explicitly.',
        )
        this.options = { ...this.options, useLLM: false }
      }
    }

    // Initialize LLM client if enabled
    if (this.options.useLLM) {
      const provider = this.options.provider
      if (provider) {
        this.llmClient = new LLMClient({
          provider,
          model: this.options.model,
          apiKey: this.options.apiKey,
          maxTokens: this.options.maxTokens,
          claudeCodeSettings: this.options.claudeCodeSettings,
          codexSettings: this.options.codexSettings,
          googleSettings: this.options.googleSettings,
        })
      }
    }
  }

  /**
   * Get the internal LLM client (for usage stats)
   */
  getLLMClient(): LLMClient | undefined {
    return this.llmClient
  }

  /**
   * Set the repository skeleton for use in batch extraction prompts.
   * Call this after the skeleton is built (async) before batch extraction starts.
   */
  setSkeleton(skeleton: string): void {
    this.options = { ...this.options, skeleton }
  }

  /**
   * Get accumulated warnings from LLM fallback events
   */
  getWarnings(): readonly string[] {
    return this.warnings
  }

  /**
   * Extract semantic features for an entity
   */
  async extract(input: EntityInput): Promise<SemanticFeature> {
    // Try LLM extraction if available
    if (this.llmClient && input.sourceCode) {
      const maxIterations = this.options.maxParseIterations ?? 3
      for (let attempt = 1; attempt <= maxIterations; attempt++) {
        try {
          return await this.extractWithLLM(input)
        }
        catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          if (attempt < maxIterations) {
            log.debug(`LLM extraction attempt ${attempt}/${maxIterations} failed for ${input.name}: ${msg}. Retrying...`)
            continue
          }
          const warningMsg = `LLM extraction failed for ${input.name} after ${maxIterations} attempts: ${msg}. Falling back to heuristic.`
          this.warnings.push(`[SemanticExtractor] ${warningMsg}`)
          log.warn(warningMsg)
        }
      }
    }

    // Use heuristic extraction
    return this.extractWithHeuristic(input)
  }

  /**
   * Extract batch of entities (with grouped batching for classes/functions and multi-iteration retry)
   */
  async extractBatch(inputs: EntityInput[]): Promise<SemanticFeature[]> {
    // Build a map of index -> result for preserving order
    const resultMap = new Map<number, SemanticFeature>()

    // Separate entities by type
    const classEntities = inputs.filter(e => e.type === 'class')
    const methodEntities = inputs.filter(e => e.type === 'method')
    const functionEntities = inputs.filter(e => e.type === 'function')

    // Build class groups: each class with its child methods
    const classGroups: ClassGroup[] = classEntities.map(classEntity => ({
      classEntity,
      methodEntities: methodEntities.filter(m => m.parent === classEntity.name),
    }))

    // Process if LLM is available
    if (this.llmClient) {
      // Split class groups into regular and test (Gap 3)
      const testClassGroups = classGroups.filter(g => isTestFile(g.classEntity.filePath))
      const regularClassGroups = classGroups.filter(g => !isTestFile(g.classEntity.filePath))

      if (regularClassGroups.length > 0) {
        await this.processClassGroupBatches(regularClassGroups, inputs, resultMap, false)
      }
      if (testClassGroups.length > 0) {
        await this.processClassGroupBatches(testClassGroups, inputs, resultMap, true)
      }

      // Split standalone functions into regular and test (Gap 3)
      const testFunctionEntities = functionEntities.filter(e => isTestFile(e.filePath))
      const regularFunctionEntities = functionEntities.filter(e => !isTestFile(e.filePath))

      if (regularFunctionEntities.length > 0) {
        await this.processFunctionBatches(regularFunctionEntities, inputs, resultMap, false)
      }
      if (testFunctionEntities.length > 0) {
        await this.processFunctionBatches(testFunctionEntities, inputs, resultMap, true)
      }
    }

    // Fall back to individual extraction for entities not yet in resultMap
    const remainingEntities = inputs.filter((_, i) => !resultMap.has(i))
    for (const entity of remainingEntities) {
      const idx = inputs.indexOf(entity)
      const feature = await this.extract(entity)
      resultMap.set(idx, feature)
    }

    // Return results in original order; fall back to heuristic for any entity
    // that was not placed in the map (e.g. if extract() threw unexpectedly)
    return inputs.map((input, i) => resultMap.get(i) ?? this.extractWithHeuristic(input))
  }

  /**
   * Process class groups using token-aware batching and parallel LLM calls.
   * Uses conversational follow-up (Gap 2) on retry iterations instead of full re-prompting.
   * Routes test classes to test-specific prompts (Gap 3) when isTest=true.
   */
  private async processClassGroupBatches(
    classGroups: ClassGroup[],
    allInputs: EntityInput[],
    resultMap: Map<number, SemanticFeature>,
    isTest = false,
  ): Promise<void> {
    const batches = this.createClassGroupBatches(classGroups)
    const maxConcurrent = this.options.maxConcurrentBatches ?? 4
    const maxIterations = this.options.maxParseIterations ?? 3

    log.debug(`Processing ${classGroups.length} class groups in ${batches.length} batches (concurrency: ${maxConcurrent}, isTest: ${isTest})`)

    const tasks = batches.map(batch => async () => {
      let pendingGroups = batch
      let iteration = 0
      let conversationMemory: Memory | undefined

      while (pendingGroups.length > 0 && iteration < maxIterations) {
        iteration++
        try {
          const { result: batchResult, memory: newMemory } = await this.extractClassBatch(
            pendingGroups,
            { memory: conversationMemory, isTest },
          )
          conversationMemory = newMemory
          const stillMissing: ClassGroup[] = []

          for (const group of pendingGroups) {
            const { classEntity, methodEntities } = group
            const classResult = batchResult.get(compositeKey(classEntity.filePath, classEntity.name))

            if (classResult instanceof Map) {
              // Class with methods: methodMap has CLASS_FEATURE_KEY entry for the class itself
              const classFeature = classResult.get(CLASS_FEATURE_KEY)
              if (classFeature) {
                const classIdx = allInputs.indexOf(classEntity)
                if (classIdx !== -1) {
                  resultMap.set(classIdx, classFeature)
                }
              }
              else if (iteration < maxIterations) {
                stillMissing.push({ classEntity, methodEntities: [] })
              }

              // Fill in method results
              const missingMethods: EntityInput[] = []
              for (const method of methodEntities) {
                const methodFeature = classResult.get(method.name)
                if (methodFeature) {
                  const methodIdx = allInputs.indexOf(method)
                  if (methodIdx !== -1) {
                    resultMap.set(methodIdx, methodFeature)
                  }
                }
                else if (iteration < maxIterations) {
                  missingMethods.push(method)
                }
              }
              // If some methods are missing and we have more iterations, retry just those methods
              if (missingMethods.length > 0 && iteration < maxIterations) {
                stillMissing.push({ classEntity: { ...classEntity, sourceCode: '' }, methodEntities: missingMethods })
              }
            }
            else if (classResult !== undefined) {
              // Data-only class (SemanticFeature)
              const classIdx = allInputs.indexOf(classEntity)
              if (classIdx !== -1) {
                resultMap.set(classIdx, classResult)
              }
            }
            else if (iteration < maxIterations) {
              // No result for this class, retry
              stillMissing.push(group)
            }
          }

          pendingGroups = stillMissing
        }
        catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          log.warn(`Class batch iteration ${iteration}/${maxIterations} failed: ${msg}`)
          this.warnings.push(`[SemanticExtractor] Class batch extraction failed (iteration ${iteration}/${maxIterations}): ${msg}. Affected entities will fall back to heuristic.`)
          break
        }
      }
    })

    await runConcurrent(tasks, maxConcurrent)
  }

  /**
   * Extract features for a batch of class groups using LLM.
   * Returns a map: className -> (Map<methodName | CLASS_FEATURE_KEY, SemanticFeature> | SemanticFeature)
   * plus the Memory object for conversational follow-up on retry (Gap 2).
   *
   * On first call (options.memory undefined): builds a full prompt and creates new Memory.
   * On retry call (options.memory provided): adds a targeted follow-up message instead of
   * re-sending all the code — the LLM already has context from the prior turn.
   */
  private async extractClassBatch(
    classGroups: ClassGroup[],
    options?: { memory?: Memory, isTest?: boolean },
  ): Promise<{ result: Map<string, Map<string, SemanticFeature> | SemanticFeature>, memory: Memory }> {
    const result = new Map<string, Map<string, SemanticFeature> | SemanticFeature>()
    let memory = options?.memory

    if (!memory) {
      // First call: build combined source code and create fresh Memory
      const codeBlocks: string[] = []
      for (const { classEntity, methodEntities } of classGroups) {
        if (classEntity.sourceCode) {
          codeBlocks.push(`// file: ${classEntity.filePath}\n${classEntity.sourceCode.replaceAll('```', '\'\'\'')}`)
        }
        else if (methodEntities.length > 0) {
          const parts = [`// file: ${classEntity.filePath}`, `class ${classEntity.name} {`]
          for (const method of methodEntities) {
            if (method.sourceCode) {
              parts.push(`  ${method.sourceCode}`)
            }
          }
          parts.push('}')
          codeBlocks.push(parts.join('\n'))
        }
      }

      if (codeBlocks.length === 0) {
        return { result, memory: new Memory({ contextWindow: 0 }) }
      }

      const repoName = this.options.repoName ?? 'unknown'
      const repoInfo = this.options.repoInfo ?? ''
      const classesCode = codeBlocks.join('\n\n')
      const skeleton = this.options.skeleton

      const buildFn = options?.isTest ? buildBatchTestClassPrompt : buildBatchClassPrompt
      const { system, user } = buildFn(repoName, repoInfo, classesCode, skeleton)

      memory = new Memory({ contextWindow: 0 })
      memory.addSystem(system)
      memory.addUser(user)
    }
    else {
      // Retry call: add targeted follow-up listing only the missing entities (Gap 2)
      const followUpMsg = this.buildClassFollowUpMessage(classGroups)
      memory.addUser(followUpMsg)
    }

    try {
      const llmResponse = await this.llmClient!.generate(memory)
      memory.addAssistant(llmResponse.content)
      const parsed = this.parseBatchResponse(llmResponse.content)

      for (const { classEntity, methodEntities } of classGroups) {
        const ck = compositeKey(classEntity.filePath, classEntity.name)
        const classData = parsed[ck]
        if (classData === undefined || classData === null) {
          continue
        }

        if (Array.isArray(classData)) {
          // Data-only class: array of feature strings
          const stringFeatures = classData.filter((f): f is string => typeof f === 'string')
          const feature = this.featureListToSemanticFeature(stringFeatures, classEntity.name, classEntity.filePath, 'class')
          result.set(ck, feature)
        }
        else if (typeof classData === 'object') {
          // Class with methods: object mapping methodName -> feature strings
          const methodDataMap = classData as Record<string, unknown>
          const methodMap = new Map<string, SemanticFeature>()
          const classFeatureStrings: string[] = []

          for (const [methodName, methodFeatures] of Object.entries(methodDataMap)) {
            if (Array.isArray(methodFeatures)) {
              const stringFeatures = methodFeatures.filter((f): f is string => typeof f === 'string')
              const methodEntity = methodEntities.find(m => m.name === methodName)
              const methodFeature = this.featureListToSemanticFeature(
                stringFeatures,
                methodName,
                methodEntity?.filePath ?? classEntity.filePath,
                'function',
              )
              methodMap.set(methodName, methodFeature)
              if (classFeatureStrings.length === 0 && stringFeatures.length > 0) {
                classFeatureStrings.push(...stringFeatures)
              }
            }
          }

          // Create a class-level feature synthesized from the method data
          const classFeature = this.featureListToSemanticFeature(
            classFeatureStrings,
            classEntity.name,
            classEntity.filePath,
            'class',
          )
          methodMap.set(CLASS_FEATURE_KEY, classFeature)

          result.set(ck, methodMap)
        }
      }
    }
    catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.warnings.push(`Class batch LLM call failed: ${msg}. Affected entities will fall back to heuristic.`)
      log.warn(`Class batch LLM call failed: ${msg}`)
    }

    return { result, memory }
  }

  /**
   * Build a targeted follow-up message listing only the missing class/method entries.
   * Used on retry iterations (Gap 2) to avoid re-sending all the code.
   */
  private buildClassFollowUpMessage(pendingGroups: ClassGroup[]): string {
    const lines: string[] = [
      'The following entries were missing from your previous response.',
      'Please provide features for ONLY these missing entries:',
    ]

    for (const { classEntity, methodEntities } of pendingGroups) {
      const ck = compositeKey(classEntity.filePath, classEntity.name)
      if (methodEntities.length === 0) {
        lines.push(`- Class "${ck}" is missing entirely`)
      }
      else {
        const methodNames = methodEntities.map(m => m.name).join(', ')
        lines.push(`- Class "${ck}" is missing methods: ${methodNames}`)
      }
    }

    lines.push('\nReturn a JSON object containing only these missing entries.')
    return lines.join('\n')
  }

  /**
   * Process standalone functions using token-aware batching and parallel LLM calls.
   * Uses conversational follow-up (Gap 2) on retry iterations instead of full re-prompting.
   * Routes test functions to test-specific prompts (Gap 3) when isTest=true.
   */
  private async processFunctionBatches(
    functionEntities: EntityInput[],
    allInputs: EntityInput[],
    resultMap: Map<number, SemanticFeature>,
    isTest = false,
  ): Promise<void> {
    const batches = this.createTokenAwareBatches(functionEntities)
    const maxConcurrent = this.options.maxConcurrentBatches ?? 4
    const maxIterations = this.options.maxParseIterations ?? 3

    log.debug(`Processing ${functionEntities.length} functions in ${batches.length} batches (concurrency: ${maxConcurrent}, isTest: ${isTest})`)

    const tasks = batches.map(batch => async () => {
      let pendingFunctions = batch
      let iteration = 0
      let conversationMemory: Memory | undefined
      const alreadyParsedNames: string[] = []
      let prevInvalidKeys: string[] = []

      while (pendingFunctions.length > 0 && iteration < maxIterations) {
        iteration++
        try {
          const { result: batchResult, memory: newMemory, invalidKeys } = await this.extractFunctionBatch(
            pendingFunctions,
            { memory: conversationMemory, isTest, alreadyParsedNames, prevInvalidKeys },
          )
          conversationMemory = newMemory
          prevInvalidKeys = invalidKeys
          const stillMissing: EntityInput[] = []

          for (const funcEntity of pendingFunctions) {
            const feature = batchResult.get(funcEntity)
            if (feature) {
              const idx = allInputs.indexOf(funcEntity)
              if (idx !== -1) {
                resultMap.set(idx, feature)
              }
              alreadyParsedNames.push(compositeKey(funcEntity.filePath, funcEntity.name))
            }
            else if (iteration < maxIterations) {
              stillMissing.push(funcEntity)
            }
          }

          pendingFunctions = stillMissing
        }
        catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          log.warn(`Function batch iteration ${iteration}/${maxIterations} failed: ${msg}`)
          this.warnings.push(`[SemanticExtractor] Function batch extraction failed (iteration ${iteration}/${maxIterations}): ${msg}. Affected entities will fall back to heuristic.`)
          break
        }
      }
    })

    await runConcurrent(tasks, maxConcurrent)
  }

  /**
   * Extract features for a batch of standalone functions using LLM.
   * Returns a map: EntityInput -> SemanticFeature (keyed by entity reference to avoid name collisions)
   * plus the Memory object for conversational follow-up on retry (Gap 2).
   *
   * On first call (options.memory undefined): builds a full prompt and creates new Memory.
   * On retry call (options.memory provided): adds a targeted follow-up message listing missing functions.
   */
  private async extractFunctionBatch(
    functionEntities: EntityInput[],
    options?: {
      memory?: Memory
      isTest?: boolean
      /** Names already successfully parsed in previous iterations (Gap 2-A) */
      alreadyParsedNames?: string[]
      /** Invalid keys returned by the model in the previous iteration (Gap 2-B) */
      prevInvalidKeys?: string[]
    },
  ): Promise<{ result: Map<EntityInput, SemanticFeature>, memory: Memory, invalidKeys: string[] }> {
    const result = new Map<EntityInput, SemanticFeature>()
    let memory = options?.memory

    if (!memory) {
      // First call: build fresh prompt with source code
      const codeBlocks = functionEntities
        .filter(e => e.sourceCode)
        .map(e => `// file: ${e.filePath}\n${e.sourceCode!.replaceAll('```', '\'\'\'')}`)

      if (codeBlocks.length === 0) {
        return { result, memory: new Memory({ contextWindow: 0 }), invalidKeys: [] }
      }

      const repoName = this.options.repoName ?? 'unknown'
      const repoInfo = this.options.repoInfo ?? ''
      const functionsCode = codeBlocks.join('\n\n')
      const skeleton = this.options.skeleton

      const buildFn = options?.isTest ? buildBatchTestFunctionPrompt : buildBatchFunctionPrompt
      const { system, user } = buildFn(repoName, repoInfo, functionsCode, skeleton)

      memory = new Memory({ contextWindow: 0 })
      memory.addSystem(system)
      memory.addUser(user)
    }
    else {
      // Retry call: add targeted follow-up with already-parsed context and invalid keys (Gap 2-A, 2-B)
      const followUpMsg = this.buildFunctionFollowUpMessage(
        functionEntities,
        options?.alreadyParsedNames ?? [],
        options?.prevInvalidKeys ?? [],
      )
      memory.addUser(followUpMsg)
    }

    let invalidKeys: string[] = []
    try {
      const llmResponse = await this.llmClient!.generate(memory)
      memory.addAssistant(llmResponse.content)
      const parsed = this.parseBatchResponse(llmResponse.content)

      // Detect keys in the response that are not valid composite keys (Gap 2-B)
      const validKeys = new Set(functionEntities.map(e => compositeKey(e.filePath, e.name)))
      invalidKeys = Object.keys(parsed).filter(k => !validKeys.has(k))

      for (const funcEntity of functionEntities) {
        const funcData = parsed[compositeKey(funcEntity.filePath, funcEntity.name)]
        if (Array.isArray(funcData)) {
          const stringFeatures = funcData.filter((f): f is string => typeof f === 'string')
          const feature = this.featureListToSemanticFeature(stringFeatures, funcEntity.name, funcEntity.filePath, 'function')
          result.set(funcEntity, feature)
        }
      }
    }
    catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.warnings.push(`Function batch LLM call failed: ${msg}. Affected entities will fall back to heuristic.`)
      log.warn(`Function batch LLM call failed: ${msg}`)
    }

    return { result, memory: memory!, invalidKeys }
  }

  /**
   * Build a targeted follow-up message listing only the missing function entries.
   * Mirrors Python semantic_parsing.py:803-811 (Gap 2-A, 2-B):
   * - includes already-parsed function names for context
   * - includes invalid key names from the previous response to correct the model
   */
  private buildFunctionFollowUpMessage(
    pendingFunctions: EntityInput[],
    alreadyParsedNames: string[],
    prevInvalidKeys: string[],
  ): string {
    const pendingNames = pendingFunctions.map(f => compositeKey(f.filePath, f.name)).join(', ')
    const lines: string[] = []

    if (alreadyParsedNames.length > 0) {
      lines.push(`So far, you've extracted features for: ${alreadyParsedNames.join(', ')}.`)
    }
    lines.push(`Functions not yet parsed: ${pendingNames}.`)
    lines.push('Please provide feature lists exclusively for the functions that are still not parsed.')

    if (prevInvalidKeys.length > 0) {
      lines.push(`\nYou also included invalid function names: ${prevInvalidKeys.join(', ')}. Ignore any invalid names and only use the function names listed above.`)
    }

    return lines.join('\n')
  }

  /**
   * Parse batch LLM response - extracts JSON from <solution> tags or raw text
   */
  private parseBatchResponse(text: string): Record<string, unknown> {
    // Try to extract from <solution> block first
    const solutionMatch = text.match(/<solution>\s*([\s\S]*?)\s*<\/solution>/)
    if (solutionMatch) {
      try {
        return JSON.parse(solutionMatch[1]!) as Record<string, unknown>
      }
      catch (error) {
        log.debug(`Failed to parse <solution> block as JSON: ${error instanceof Error ? error.message : String(error)}`)
        // Fall through to raw JSON extraction
      }
    }

    // Try to find JSON object in the text
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as Record<string, unknown>
      }
      catch (error) {
        log.debug(`Failed to parse raw JSON from batch response: ${error instanceof Error ? error.message : String(error)}`)
        // Fall through
      }
    }

    log.warn('Could not parse batch response as JSON')
    return {}
  }

  /**
   * Convert a list of feature strings to a SemanticFeature
   */
  private featureListToSemanticFeature(
    features: string[],
    entityName: string,
    filePath: string,
    entityType: EntityInput['type'] = 'function',
  ): SemanticFeature {
    if (features.length === 0) {
      return this.extractWithHeuristic({ type: entityType, name: entityName, filePath })
    }

    const primaryDescription = features[0]!.replace(/\//g, ' or ')
    const subFeatures = features.slice(1).filter(f => f.length > 0).map(f => f.replace(/\//g, ' or '))

    const validated = this.validateFeatureName(primaryDescription)
    const validatedSubFeatures = [
      ...(validated.subFeatures ?? []),
      ...subFeatures.map(sf => this.validateFeatureName(sf).description),
    ]

    const keywords = this.extractKeywords({ type: entityType, name: entityName, filePath })

    return {
      description: validated.description,
      subFeatures: validatedSubFeatures.length > 0 ? validatedSubFeatures : undefined,
      keywords,
    }
  }

  /**
   * Create token-aware batches from entities.
   *
   * Groups entities greedily until maxBatchTokens is reached.
   * If a single entity exceeds maxBatchTokens, it gets its own batch.
   * If the last batch has fewer tokens than minBatchTokens, it's merged with the previous batch.
   *
   * @param inputs - Array of entities to batch
   * @returns Array of batches, where each batch is an array of entities
   */
  private createTokenAwareBatches(inputs: EntityInput[]): EntityInput[][] {
    if (inputs.length === 0) {
      return []
    }

    const batches: EntityInput[][] = []
    const batchTokenCounts: number[] = []
    let currentBatch: EntityInput[] = []
    let currentTokens = 0

    const maxBatchTokens = this.options.maxBatchTokens ?? 50000
    const minBatchTokens = this.options.minBatchTokens ?? 10000

    for (const entity of inputs) {
      const entityTokens = estimateEntityTokens(entity)

      if (entityTokens > maxBatchTokens) {
        if (currentBatch.length > 0) {
          batches.push(currentBatch)
          batchTokenCounts.push(currentTokens)
          currentBatch = []
          currentTokens = 0
        }
        batches.push([entity])
        batchTokenCounts.push(entityTokens)
        continue
      }

      if (currentBatch.length > 0 && currentTokens + entityTokens > maxBatchTokens) {
        batches.push(currentBatch)
        batchTokenCounts.push(currentTokens)
        currentBatch = [entity]
        currentTokens = entityTokens
      }
      else {
        currentBatch.push(entity)
        currentTokens += entityTokens
      }
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch)
      batchTokenCounts.push(currentTokens)
    }

    if (batches.length > 1) {
      const lastBatchTokens = batchTokenCounts.at(-1)!
      const prevBatchTokens = batchTokenCounts[batchTokenCounts.length - 2]!

      if (lastBatchTokens < minBatchTokens && prevBatchTokens + lastBatchTokens <= maxBatchTokens) {
        const lastBatch = batches.at(-1)!
        const previousBatch = batches[batches.length - 2]!
        previousBatch.push(...lastBatch)
        batchTokenCounts[batchTokenCounts.length - 2]! += lastBatchTokens
        batches.pop()
        batchTokenCounts.pop()
      }
    }

    return batches
  }

  /**
   * Create token-aware batches from class groups.
   * Each group's token estimate is the sum of the class + all its methods.
   */
  private createClassGroupBatches(classGroups: ClassGroup[]): ClassGroup[][] {
    if (classGroups.length === 0) {
      return []
    }

    const batches: ClassGroup[][] = []
    const batchTokenCounts: number[] = []
    let currentBatch: ClassGroup[] = []
    let currentTokens = 0

    const maxBatchTokens = this.options.maxBatchTokens ?? 50000
    const minBatchTokens = this.options.minBatchTokens ?? 10000

    for (const group of classGroups) {
      const groupTokens = estimateEntityTokens(group.classEntity)
        + group.methodEntities.reduce((sum, m) => sum + estimateEntityTokens(m), 0)

      if (groupTokens > maxBatchTokens) {
        if (currentBatch.length > 0) {
          batches.push(currentBatch)
          batchTokenCounts.push(currentTokens)
          currentBatch = []
          currentTokens = 0
        }
        batches.push([group])
        batchTokenCounts.push(groupTokens)
        continue
      }

      if (currentBatch.length > 0 && currentTokens + groupTokens > maxBatchTokens) {
        batches.push(currentBatch)
        batchTokenCounts.push(currentTokens)
        currentBatch = [group]
        currentTokens = groupTokens
      }
      else {
        currentBatch.push(group)
        currentTokens += groupTokens
      }
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch)
      batchTokenCounts.push(currentTokens)
    }

    if (batches.length > 1) {
      const lastBatchTokens = batchTokenCounts.at(-1)!
      const prevBatchTokens = batchTokenCounts[batchTokenCounts.length - 2]!

      if (lastBatchTokens < minBatchTokens && prevBatchTokens + lastBatchTokens <= maxBatchTokens) {
        const lastBatch = batches.at(-1)!
        const previousBatch = batches[batches.length - 2]!
        previousBatch.push(...lastBatch)
        batchTokenCounts[batchTokenCounts.length - 2]! += lastBatchTokens
        batches.pop()
        batchTokenCounts.pop()
      }
    }

    return batches
  }

  /**
   * Aggregate child entity features into a file-level summary.
   *
   * Synthesizes function/class-level features into a coherent file-level description.
   * Only considers direct children (functions/classes at file level), not nested methods.
   *
   * When skipLLM is true (Gap 4 deferred mode), always uses the heuristic so the caller
   * can replace the result with a batch LLM summary later.
   */
  async aggregateFileFeatures(
    childFeatures: SemanticFeature[],
    fileName: string,
    filePath: string,
    skipLLM = false,
  ): Promise<SemanticFeature> {
    if (childFeatures.length === 0) {
      const humanName = this.humanizeName(fileName)
      return {
        description: `define ${humanName} module`,
        keywords: [fileName.toLowerCase()],
      }
    }

    if (this.llmClient && !skipLLM) {
      try {
        return await this.aggregateWithLLM(childFeatures, fileName, filePath)
      }
      catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const warning = `LLM aggregation failed for ${fileName}: ${msg}. Falling back to heuristic.`
        this.warnings.push(warning)
        log.warn(warning)
      }
    }

    return this.aggregateWithHeuristic(childFeatures, fileName)
  }

  /**
   * Aggregate multiple files' child features into file-level summaries using batched LLM calls (Gap 4).
   *
   * Improvements over the initial implementation:
   * - 4-A: includes entity names/types in the LLM prompt for richer context (mirrors Python feature_map format)
   * - 4-B: splits files into token-aware batches and processes them in parallel
   * - 4-C: uses Memory-based conversational retry for missing files within each batch
   *
   * Returns a map of filePath -> SemanticFeature. Falls back to heuristic for any file
   * that does not get an LLM result.
   */
  async aggregateFileFeaturesInBatch(
    files: Array<{
      fileName: string
      filePath: string
      childFeatures: SemanticFeature[]
      /** Enriched entity view with name/type for more informative LLM prompts (Gap 4-A) */
      childEntities?: Array<{ name: string, type: string, feature: SemanticFeature }>
    }>,
  ): Promise<Map<string, SemanticFeature>> {
    const resultMap = new Map<string, SemanticFeature>()

    const filesToProcess = files.filter(f => f.childFeatures.length > 0)
    const emptyFiles = files.filter(f => f.childFeatures.length === 0)

    // Use heuristic for files with no child features
    for (const f of emptyFiles) {
      const humanName = this.humanizeName(f.fileName)
      resultMap.set(f.filePath, {
        description: `define ${humanName} module`,
        keywords: [f.fileName.toLowerCase()],
      })
    }

    if (!this.llmClient || filesToProcess.length === 0) {
      for (const f of filesToProcess) {
        resultMap.set(f.filePath, this.aggregateWithHeuristic(f.childFeatures, f.fileName))
      }
      return resultMap
    }

    // Gap 4-B: split files into token-aware batches for parallel processing
    const batches = this.createFileSummaryBatches(filesToProcess)
    log.debug(`File summary batch: ${filesToProcess.length} files split into ${batches.length} batches`)

    const maxConcurrent = this.options.maxConcurrentBatches ?? 4
    const batchTasks = batches.map(batch => () => this.runFileSummaryBatch(batch, resultMap))
    await runConcurrent(batchTasks, maxConcurrent)

    // Fallback to heuristic for any file that didn't get an LLM result
    for (const f of filesToProcess) {
      if (!resultMap.has(f.filePath)) {
        resultMap.set(f.filePath, this.aggregateWithHeuristic(f.childFeatures, f.fileName))
      }
    }

    return resultMap
  }

  /**
   * Estimate the token cost of a single file's feature data for batching.
   * Counts characters across all feature strings and divides by 4 (chars-per-token estimate).
   */
  private estimateFileSummaryTokens(f: {
    childFeatures: SemanticFeature[]
    childEntities?: Array<{ name: string, type: string, feature: SemanticFeature }>
  }): number {
    const texts: string[] = []
    if (f.childEntities && f.childEntities.length > 0) {
      for (const e of f.childEntities) {
        texts.push(e.name, e.type, e.feature.description, ...(e.feature.subFeatures ?? []))
      }
    }
    else {
      for (const feat of f.childFeatures) {
        texts.push(feat.description, ...(feat.subFeatures ?? []))
      }
    }
    const totalChars = texts.reduce((sum, t) => sum + t.length, 0)
    return Math.ceil(totalChars / 4) + 50 // 50 tokens overhead per file entry
  }

  /**
   * Split files into token-aware batches for file summary generation (Gap 4-B).
   * Mirrors Python _make_file_summary_batches() with min=1000/max=8000 token defaults.
   */
  private createFileSummaryBatches<T extends { childFeatures: SemanticFeature[], childEntities?: Array<{ name: string, type: string, feature: SemanticFeature }> }>(
    files: T[],
  ): T[][] {
    const SUMMARY_MIN_BATCH_TOKENS = 1000
    const SUMMARY_MAX_BATCH_TOKENS = 8000

    const batches: T[][] = []
    let currentBatch: T[] = []
    let currentTokens = 0

    for (const f of files) {
      const tokens = this.estimateFileSummaryTokens(f)

      if (currentBatch.length > 0 && currentTokens + tokens > SUMMARY_MAX_BATCH_TOKENS) {
        batches.push(currentBatch)
        currentBatch = [f]
        currentTokens = tokens
      }
      else {
        currentBatch.push(f)
        currentTokens += tokens
      }
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch)
    }

    // Merge last batch into previous if it is too small (mirrors min-batch logic)
    if (batches.length > 1) {
      const last = batches.at(-1)!
      const lastTokens = last.reduce((s, f) => s + this.estimateFileSummaryTokens(f), 0)
      const prev = batches[batches.length - 2]!
      const prevTokens = prev.reduce((s, f) => s + this.estimateFileSummaryTokens(f), 0)
      if (lastTokens < SUMMARY_MIN_BATCH_TOKENS && prevTokens + lastTokens <= SUMMARY_MAX_BATCH_TOKENS) {
        prev.push(...last)
        batches.pop()
      }
    }

    return batches
  }

  /**
   * Run a single file-summary batch with Memory-based retry for missing files (Gap 4-C).
   * Mirrors Python summarize_file_batch() conversational retry logic.
   */
  private async runFileSummaryBatch(
    batch: Array<{
      fileName: string
      filePath: string
      childFeatures: SemanticFeature[]
      childEntities?: Array<{ name: string, type: string, feature: SemanticFeature }>
    }>,
    resultMap: Map<string, SemanticFeature>,
  ): Promise<void> {
    const MAX_SUMMARY_ITERATIONS = 3

    // Build prompt entries using enriched entity names when available (Gap 4-A)
    const summaryFiles = batch.map(f => ({
      fileName: f.fileName,
      filePath: f.filePath,
      features: f.childFeatures.map((feat) => {
        const sub = feat.subFeatures?.length ? ` (also: ${feat.subFeatures.join(', ')})` : ''
        return `${feat.description}${sub}`
      }),
      childEntities: f.childEntities,
    }))

    const { system, user } = buildBatchFileSummaryPrompt(
      summaryFiles,
      this.options.repoName,
      this.options.repoInfo,
      this.options.skeleton,
    )

    const memory = new Memory({ contextWindow: 0 })
    memory.addSystem(system)
    memory.addUser(user)

    for (let iteration = 1; iteration <= MAX_SUMMARY_ITERATIONS; iteration++) {
      try {
        const llmResponse = await this.llmClient!.generate(memory)
        memory.addAssistant(llmResponse.content)
        const parsed = this.parseBatchResponse(llmResponse.content)

        for (const f of batch) {
          if (resultMap.has(f.filePath))
            continue
          const fileData = parsed[f.filePath] as unknown
          if (fileData && typeof fileData === 'object' && 'description' in fileData && typeof (fileData as Record<string, unknown>).description === 'string') {
            const raw = fileData as Record<string, unknown>
            const description = raw.description as string
            const keywords = Array.isArray(raw.keywords)
              ? (raw.keywords as unknown[]).filter((k): k is string => typeof k === 'string')
              : undefined
            const validated = this.validateFeatureName(description)
            resultMap.set(f.filePath, {
              description: validated.description,
              subFeatures: validated.subFeatures,
              keywords: keywords?.map(k => k.toLowerCase().trim()).filter(k => k.length > 0)
                ?? this.mergeKeywords(f.childFeatures, f.fileName),
            })
          }
        }
      }
      catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const warning = `Batch file summary LLM call (iteration ${iteration}/${MAX_SUMMARY_ITERATIONS}) failed: ${msg}. Falling back to heuristic.`
        this.warnings.push(`[SemanticExtractor] ${warning}`)
        log.warn(warning)
        break
      }

      // Gap 4-C: identify missing files and send follow-up if needed
      const missingPaths = batch.filter(f => !resultMap.has(f.filePath)).map(f => f.filePath)
      if (missingPaths.length === 0 || iteration === MAX_SUMMARY_ITERATIONS)
        break

      const followUp = [
        `You missed the following files: ${JSON.stringify(missingPaths)}`,
        'Please provide summaries for these files only.',
        'Return a JSON object mapping each missed file path to its summary.',
      ].join('\n')
      memory.addUser(followUp)
    }
  }

  /**
   * Aggregate file features using LLM
   */
  private async aggregateWithLLM(
    childFeatures: SemanticFeature[],
    fileName: string,
    filePath: string,
  ): Promise<SemanticFeature> {
    const featureList = childFeatures
      .map((f) => {
        const subFeatureSuffix = f.subFeatures?.length ? ` (also: ${f.subFeatures.join(', ')})` : ''
        return `- ${f.description}${subFeatureSuffix}`
      })
      .join('\n')

    const prompt = `Synthesize a file-level semantic summary for "${fileName}" (${filePath}).

The file contains the following entities and their features:
${featureList}

Provide a single cohesive description that captures what this file does as a whole.
Use verb + object format. Keep it concise (3-8 words).

Respond with valid JSON:
{
  "description": "file-level summary in verb + object format",
  "keywords": ["relevant", "keywords"]
}`

    const systemPrompt = `You are a senior software analyst. Synthesize file-level summaries from child entity features.
Follow the same naming rules: verb + object format, lowercase, no implementation details, 3-8 words.`

    const response = await this.llmClient?.completeJSON<SemanticFeature>(prompt, systemPrompt, SemanticFeatureSchema)
    if (!response) {
      return this.aggregateWithHeuristic(childFeatures, fileName)
    }

    const validated = this.validateFeatureName(response.description)
    return {
      description: validated.description,
      subFeatures: validated.subFeatures,
      keywords: response.keywords ?? this.mergeKeywords(childFeatures, fileName),
    }
  }

  /**
   * Aggregate file features using heuristics
   */
  private aggregateWithHeuristic(
    childFeatures: SemanticFeature[],
    fileName: string,
  ): SemanticFeature {
    const descriptions = childFeatures.map(f => f.description)

    const verbs = descriptions
      .map(d => d.split(/\s+/)[0])
      .filter((v): v is string => v !== undefined)

    const verbCounts = new Map<string, number>()
    for (const verb of verbs) {
      verbCounts.set(verb, (verbCounts.get(verb) ?? 0) + 1)
    }

    const primaryVerb = [...verbCounts].toSorted((a, b) => b[1] - a[1])[0]?.[0] ?? 'provide'

    const humanName = this.humanizeName(fileName)
    const description = `${primaryVerb} ${humanName} functionality`

    const keywords = this.mergeKeywords(childFeatures, fileName)

    return {
      description,
      subFeatures: descriptions.length > 1 ? descriptions : undefined,
      keywords,
    }
  }

  /**
   * Merge and deduplicate keywords from child features
   */
  private mergeKeywords(childFeatures: SemanticFeature[], fileName: string): string[] {
    const keywordSet = new Set<string>()
    keywordSet.add(fileName.toLowerCase())

    for (const feature of childFeatures) {
      for (const kw of feature.keywords) {
        keywordSet.add(kw.toLowerCase())
      }
    }

    return [...keywordSet]
  }

  /**
   * Extract semantic features using LLM
   */
  private async extractWithLLM(input: EntityInput): Promise<SemanticFeature> {
    const prompt = this.buildPrompt(input)
    const systemPrompt = `You are a senior software analyst. Your task is to extract high-level semantic features from a code entity.

## Key Goals
- Focus on the purpose and high-level behavior of the entity - what it represents or manages in the system.
- Summarize what the entity is responsible for at a high level, avoiding any implementation details.

## Feature Extraction Principles
1. Focus on the purpose and behavior of the entity - what it represents or manages.
2. Do NOT describe implementation details, variable names, or internal logic such as loops, conditionals, or data structures.
3. If an entity performs multiple responsibilities, break them down into separate features.
4. Use the entity name, its code, and the surrounding context to infer meaning.
5. Do not fabricate or invent behaviors not present in the code.
6. Do not skip any defined behavior, including initialization, cleanup, and lifecycle methods.

## Feature Naming Rules
1. Use the "verb + object" format - e.g., "load config", "validate token"
2. Use lowercase English only.
3. Describe purpose, not implementation - focus on what the code does, not how.
4. Each feature should express one single responsibility.
5. If an entity performs multiple responsibilities, create multiple short features, each describing only one responsibility.
6. Keep each feature short and atomic: prefer 3-8 words, no full sentences, no punctuation inside a feature.
7. Avoid vague verbs: avoid "handle", "process", "deal with". Prefer "load", "validate", "convert", "update", "serialize", "compute", "check", "transform".
8. Avoid implementation details: do not mention loops, conditionals, specific data structures, or control flow.
9. Avoid mentioning specific libraries, frameworks, or formats. Say "serialize data" not "convert to JSON".
10. Prefer domain or system semantic words over low-level technical actions: "manage session" not "update dict".
11. Avoid chaining multiple actions: instead of "initialize config and register globally", use separate features.

Always respond with valid JSON:
{
  "description": "primary verb + object feature",
  "subFeatures": ["additional atomic feature 1", "additional atomic feature 2"],
  "keywords": ["relevant", "search", "keywords"]
}

If the entity has only one responsibility, leave subFeatures as an empty array.`

    const response = await this.llmClient?.completeJSON<SemanticFeature>(prompt, systemPrompt, SemanticFeatureSchema)
    if (!response) {
      return this.extractWithHeuristic(input)
    }
    return this.validateFeature(response, input)
  }

  /**
   * Build prompt for LLM extraction
   */
  private buildPrompt(input: EntityInput): string {
    let prompt = `Analyze this ${input.type} and extract its semantic features.\n\n`

    if (input.parent) {
      prompt += `Parent class: ${input.parent}\n`
    }

    prompt += `Name: ${input.name}\n`
    prompt += `File: ${input.filePath}\n`

    if (input.documentation) {
      prompt += `\nDocumentation:\n${input.documentation}\n`
    }

    if (input.sourceCode) {
      const maxSourceLength = 2000
      const truncatedSource
        = input.sourceCode.length > maxSourceLength
          ? `${input.sourceCode.substring(0, maxSourceLength)}\n... (truncated)`
          : input.sourceCode

      prompt += `\nSource code:\n\`\`\`\n${truncatedSource}\n\`\`\`\n`
    }

    prompt += `\nProvide semantic features for this ${input.type}.`

    return prompt
  }

  /**
   * Extract semantic features using heuristics (no LLM)
   */
  private extractWithHeuristic(input: EntityInput): SemanticFeature {
    const description = this.generateDescription(input)
    const keywords = this.extractKeywords(input)

    const validated = this.validateFeatureName(description)
    return {
      description: validated.description,
      subFeatures: validated.subFeatures,
      keywords,
    }
  }

  /**
   * Generate description from entity name and type
   */
  private generateDescription(input: EntityInput): string {
    const name = this.humanizeName(input.name)

    switch (input.type) {
      case 'function':
        return this.generateFunctionDescription(name, input)
      case 'class':
        return `define ${name}`
      case 'method':
        return this.generateFunctionDescription(name, input)
      case 'file':
        return this.generateFileDescription(input.filePath)
      default:
        return name
    }
  }

  /**
   * Generate function description based on common patterns
   */
  private generateFunctionDescription(name: string, _input: EntityInput): string {
    const lowerName = name.toLowerCase()

    const verbPatterns: Array<[string, string]> = [
      ['get', 'retrieve'],
      ['set', 'set'],
      ['is', 'check if'],
      ['has', 'check if has'],
      ['can', 'check if can'],
      ['should', 'determine if should'],
      ['validate', 'validate'],
      ['parse', 'parse'],
      ['format', 'format'],
      ['create', 'create'],
      ['build', 'build'],
      ['make', 'create'],
      ['init', 'initialize'],
      ['setup', 'set up'],
      ['load', 'load'],
      ['save', 'save'],
      ['fetch', 'fetch'],
      ['send', 'send'],
      ['handle', 'dispatch'],
      ['process', 'transform'],
      ['transform', 'transform'],
      ['convert', 'convert'],
      ['extract', 'extract'],
      ['find', 'find'],
      ['search', 'search'],
      ['filter', 'filter'],
      ['sort', 'sort'],
      ['update', 'update'],
      ['delete', 'delete'],
      ['remove', 'remove'],
      ['add', 'add'],
      ['insert', 'insert'],
      ['render', 'render'],
      ['display', 'display'],
      ['show', 'show'],
      ['hide', 'hide'],
      ['toggle', 'toggle'],
      ['enable', 'enable'],
      ['disable', 'disable'],
      ['start', 'start'],
      ['stop', 'stop'],
      ['run', 'execute'],
      ['execute', 'execute'],
      ['on', 'dispatch'],
    ]

    for (const [prefix, verb] of verbPatterns) {
      if (lowerName.startsWith(prefix)) {
        const rest = name.substring(prefix.length).trim()
        if (rest) {
          return `${verb} ${rest.toLowerCase()}`
        }
      }
    }

    return `provide ${name} operation`
  }

  /**
   * Generate file description from path
   */
  private generateFileDescription(filePath: string): string {
    const parts = filePath.split('/')
    const fileName = (parts.at(-1) ?? '').replace(/\.[^.]+$/, '')
    const dirName = parts.length > 1 ? (parts[parts.length - 2] ?? '') : ''

    const humanName = this.humanizeName(fileName)

    if (dirName && dirName !== '.') {
      return `define ${humanName} for ${dirName}`
    }
    return `define ${humanName} module`
  }

  /**
   * Convert camelCase/PascalCase/snake_case to human-readable
   */
  private humanizeName(name: string): string {
    return name
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]/g, ' ')
      .toLowerCase()
      .trim()
  }

  /**
   * Extract keywords from entity
   */
  private extractKeywords(input: EntityInput): string[] {
    const keywords = new Set<string>()

    const nameParts = input.name
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]/g, ' ')
      .toLowerCase()
      .split(' ')
      .filter(w => w.length > 2)

    for (const part of nameParts) {
      keywords.add(part)
    }

    keywords.add(input.type)

    if (input.parent) {
      keywords.add(input.parent.toLowerCase())
    }

    const pathParts = input.filePath
      .split('/')
      .filter(p => p && p !== '.' && p !== '..')
      .map(p => p.replace(/\.[^.]+$/, '').toLowerCase())

    for (const part of pathParts) {
      if (part.length > 2) {
        keywords.add(part)
      }
    }

    return [...keywords]
  }

  /**
   * Vague verbs that should be replaced with more specific alternatives
   */
  private static readonly VAGUE_VERBS = new Set([
    'handle',
    'process',
    'deal with',
    'do',
    'manage',
    'run',
    'perform',
  ])

  /**
   * Preferred replacements for vague verbs (used as suggestions)
   */
  private static readonly VAGUE_VERB_REPLACEMENTS: Record<string, string> = {
    'handle': 'dispatch',
    'process': 'transform',
    'deal with': 'resolve',
    'do': 'execute',
    'manage': 'coordinate',
    'run': 'execute',
    'perform': 'execute',
  }

  /**
   * Implementation detail keywords to strip from feature names
   */
  private static readonly IMPLEMENTATION_KEYWORDS = new Set([
    'loop',
    'iterate',
    'if',
    'else',
    'array',
    'dict',
    'hash',
    'stack',
    'queue',
    'for',
    'while',
    'switch',
    'case',
    'try',
    'catch',
    'throw',
    'return',
    'break',
    'continue',
  ])

  /**
   * Non-action words that indicate a fragment is not a verb phrase
   */
  private static readonly NON_ACTION_PREFIXES = new Set([
    'a',
    'an',
    'the',
    'their',
    'its',
    'his',
    'her',
    'our',
    'your',
    'this',
    'that',
    'these',
    'those',
    'some',
    'all',
    'each',
    'every',
  ])

  /**
   * Check if text looks like an action (verb phrase) rather than a noun fragment
   */
  private looksLikeAction(text: string): boolean {
    const firstWord = text.split(/\s+/)[0]
    if (!firstWord)
      return false
    return !SemanticExtractor.NON_ACTION_PREFIXES.has(firstWord)
  }

  /**
   * Replace a vague leading verb with a more specific alternative
   */
  private replaceVagueVerb(text: string): string {
    const words = text.split(/\s+/)
    if (words.length > 0 && SemanticExtractor.VAGUE_VERBS.has(words[0]!)) {
      const replacement = SemanticExtractor.VAGUE_VERB_REPLACEMENTS[words[0]!]
      if (replacement) {
        words[0] = replacement
        return words.join(' ')
      }
    }
    return text
  }

  /**
   * Validate and normalize a feature name according to paper's naming rules.
   *
   * Rules enforced:
   * 1. Lowercase only
   * 2. Word count: 3-8 words (truncate if >8)
   * 3. Vague verb detection/replacement
   * 4. Implementation detail removal
   * 5. No trailing punctuation
   * 6. Single responsibility check ("and" splits into subFeatures)
   */
  validateFeatureName(description: string): { description: string, subFeatures?: string[] } {
    let desc = description.toLowerCase().trim()

    // Rule 5: Remove trailing punctuation
    desc = desc.replace(/[.,;:!?]+$/, '').trim()

    // Rule 4: Strip implementation detail keywords
    const words = desc.split(/\s+/)
    const filteredWords = words.filter(w => !SemanticExtractor.IMPLEMENTATION_KEYWORDS.has(w))
    desc = filteredWords.join(' ')

    // Rule 6: Single responsibility check - split on all "and" connecting actions
    let subFeatures: string[] | undefined
    const andParts = desc.split(' and ')
    if (andParts.length > 1) {
      const first = andParts[0]!.trim()
      const rest = andParts
        .slice(1)
        .map(p => p.trim())
        .filter(p => p.length > 0)
        .filter(p => this.looksLikeAction(p))
      if (first.split(/\s+/).length >= 2 && rest.length > 0) {
        desc = first
        subFeatures = rest
      }
    }

    // Rule 3: Replace vague verbs (apply to both primary description and subFeatures)
    desc = this.replaceVagueVerb(desc)
    if (subFeatures) {
      subFeatures = subFeatures.map(sf => this.replaceVagueVerb(sf))
    }

    // Rule 2: Word count check (3-8 words; truncate if >8, keep as-is if <3)
    const finalWords = desc.split(/\s+/).filter(w => w.length > 0)
    if (finalWords.length > 8) {
      desc = finalWords.slice(0, 8).join(' ')
    }
    else {
      desc = finalWords.join(' ')
    }

    return subFeatures ? { description: desc, subFeatures } : { description: desc }
  }

  /**
   * Validate and normalize LLM response
   */
  private validateFeature(feature: SemanticFeature, input: EntityInput): SemanticFeature {
    if (!feature.description || typeof feature.description !== 'string') {
      feature.description = this.generateDescription(input)
    }

    const validated = this.validateFeatureName(feature.description)
    feature.description = validated.description
    if (validated.subFeatures) {
      feature.subFeatures = [...(feature.subFeatures ?? []), ...validated.subFeatures]
    }

    if (!Array.isArray(feature.keywords)) {
      feature.keywords = this.extractKeywords(input)
    }

    feature.keywords = feature.keywords
      .filter(k => typeof k === 'string' && k.length > 0)
      .map(k => k.toLowerCase().trim())

    return feature
  }
}
