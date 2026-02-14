import type { ClaudeCodeSettings, CodexCliSettings, LLMProvider } from '@pleaseai/rpg-utils/llm'
import { SemanticFeatureSchema as NodeSemanticFeatureSchema } from '@pleaseai/rpg-graph/node'
import { LLMClient } from '@pleaseai/rpg-utils/llm'
import { z } from 'zod/v4'

/**
 * Options for semantic extraction
 */
export interface SemanticOptions {
  /** LLM provider to use */
  provider?: LLMProvider
  /** Model name (e.g., 'gpt-5.2', 'haiku', 'gemini-3-flash-preview') */
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
 * Semantic extractor using LLM or heuristics
 */
export class SemanticExtractor {
  private readonly llmClient?: LLMClient
  private readonly options: SemanticOptions
  private readonly warnings: string[] = []

  constructor(options: SemanticOptions = {}) {
    this.options = {
      useLLM: true,
      maxTokens: 1024,
      ...options,
    }

    // Initialize LLM client if enabled
    if (this.options.useLLM) {
      const provider = this.options.provider ?? this.detectProvider()
      if (provider) {
        this.llmClient = new LLMClient({
          provider,
          model: this.options.model,
          apiKey: this.options.apiKey,
          maxTokens: this.options.maxTokens,
          claudeCodeSettings: this.options.claudeCodeSettings,
          codexSettings: this.options.codexSettings,
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
   * Get accumulated warnings from LLM fallback events
   */
  getWarnings(): readonly string[] {
    return this.warnings
  }

  /**
   * Detect available LLM provider from environment
   * Priority: Google (free tier) > Anthropic > OpenAI
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

  /**
   * Extract semantic features for an entity
   */
  async extract(input: EntityInput): Promise<SemanticFeature> {
    // Try LLM extraction if available
    if (this.llmClient && input.sourceCode) {
      try {
        return await this.extractWithLLM(input)
      }
      catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const warning = `[SemanticExtractor] LLM extraction failed for ${input.name}: ${msg}. Falling back to heuristic.`
        this.warnings.push(warning)
        console.warn(warning)
      }
    }

    // Use heuristic extraction
    return this.extractWithHeuristic(input)
  }

  /**
   * Extract batch of entities (with batching for efficiency)
   */
  async extractBatch(inputs: EntityInput[]): Promise<SemanticFeature[]> {
    const results: SemanticFeature[] = []

    // Process in batches to avoid rate limits
    const batchSize = 5
    for (let i = 0; i < inputs.length; i += batchSize) {
      const batch = inputs.slice(i, i + batchSize)
      const batchResults = await Promise.all(batch.map(input => this.extract(input)))
      results.push(...batchResults)
    }

    return results
  }

  /**
   * Aggregate child entity features into a file-level summary.
   *
   * Synthesizes function/class-level features into a coherent file-level description.
   * Only considers direct children (functions/classes at file level), not nested methods.
   */
  async aggregateFileFeatures(
    childFeatures: SemanticFeature[],
    fileName: string,
    filePath: string,
  ): Promise<SemanticFeature> {
    // Empty children: fall back to file name
    if (childFeatures.length === 0) {
      const humanName = this.humanizeName(fileName)
      return {
        description: `define ${humanName} module`,
        keywords: [fileName.toLowerCase()],
      }
    }

    // Try LLM aggregation if available
    if (this.llmClient) {
      try {
        return await this.aggregateWithLLM(childFeatures, fileName, filePath)
      }
      catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const warning = `[SemanticExtractor] LLM aggregation failed for ${fileName}: ${msg}. Falling back to heuristic.`
        this.warnings.push(warning)
        console.warn(warning)
      }
    }

    // Heuristic aggregation
    return this.aggregateWithHeuristic(childFeatures, fileName)
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

    // Validate the response
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
    // Collect all descriptions as sub-features, use a synthesized summary as primary
    const descriptions = childFeatures.map(f => f.description)

    // Find the most common verb to use as the primary action
    const verbs = descriptions
      .map(d => d.split(/\s+/)[0])
      .filter((v): v is string => v !== undefined)

    const verbCounts = new Map<string, number>()
    for (const verb of verbs) {
      verbCounts.set(verb, (verbCounts.get(verb) ?? 0) + 1)
    }

    // Use the most frequent verb, or "provide" as default
    const primaryVerb = [...verbCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'provide'

    const humanName = this.humanizeName(fileName)
    const description = `${primaryVerb} ${humanName} functionality`

    // Merge keywords from all children
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
    const systemPrompt = `You are a senior software analyst.
Your goal is to analyze the given code entity and return its key semantic features -- what it does, not how it's implemented.

## Feature Extraction Principles
1. Focus on the purpose and behavior of the function -- what role it serves in the system.
2. Do NOT describe implementation details, variable names, or internal logic such as loops, conditionals, or data structures.
3. If a function performs multiple responsibilities, break them down into separate features.
4. Use the function's name, signature, and code to infer its intent.
5. Only analyze the entity in the current input -- do not guess or invent other entities.
6. Do not omit any function, including utility or helper functions.

## Feature Naming Rules
1. Use verb + object format (e.g., "load config", "validate token").
2. Use lowercase English only.
3. Describe purpose not implementation (focus on what, not how).
4. Each feature must express one single responsibility.
5. If a method has multiple responsibilities, split into multiple atomic features.
6. Keep features short and atomic (prefer 3-8 words; no full sentences; no punctuation).
7. Avoid vague verbs ("handle", "process", "deal with"); prefer precise verbs ("load", "validate", "convert", "update", "serialize", "compute", "check", "transform").
8. Avoid implementation details (no loops, conditionals, data structures, control flow).
9. Avoid libraries/frameworks/formats (say "serialize data", not "pickle object" / "save to json").
10. Prefer domain/system semantics over low-level actions ("manage session" > "update dict").
11. Avoid chaining actions (don't write "initialize config and register globally"; split into separate features).

Always respond with valid JSON in this exact format:
{
  "description": "primary verb + object feature (e.g., 'validate user credentials')",
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
      // Truncate long source code
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

    // Apply feature naming validation to heuristic output
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

    // Common verb patterns
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

    // Default: use verb + object format with the name
    return `provide ${name} operation`
  }

  /**
   * Generate file description from path
   */
  private generateFileDescription(filePath: string): string {
    const parts = filePath.split('/')
    const fileName = (parts[parts.length - 1] ?? '').replace(/\.[^.]+$/, '')
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

    // Add name parts
    const nameParts = input.name
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]/g, ' ')
      .toLowerCase()
      .split(' ')
      .filter(w => w.length > 2)

    for (const part of nameParts) {
      keywords.add(part)
    }

    // Add type
    keywords.add(input.type)

    // Add parent if exists
    if (input.parent) {
      keywords.add(input.parent.toLowerCase())
    }

    // Add path parts
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

    // Rule 6: Single responsibility check — split on all "and" connecting actions
    let subFeatures: string[] | undefined
    const andParts = desc.split(' and ')
    if (andParts.length > 1) {
      const first = andParts[0]!.trim()
      const rest = andParts
        .slice(1)
        .map(p => p.trim())
        .filter(p => p.length > 0)
        .filter(p => this.looksLikeAction(p))
      // Only split if first part has >= 2 words and at least one rest part is a valid action
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
    // Ensure required fields exist
    if (!feature.description || typeof feature.description !== 'string') {
      feature.description = this.generateDescription(input)
    }

    // Apply feature naming validation
    const validated = this.validateFeatureName(feature.description)
    feature.description = validated.description
    if (validated.subFeatures) {
      feature.subFeatures = [...(feature.subFeatures ?? []), ...validated.subFeatures]
    }

    if (!Array.isArray(feature.keywords)) {
      feature.keywords = this.extractKeywords(input)
    }

    // Clean up keywords
    feature.keywords = feature.keywords
      .filter(k => typeof k === 'string' && k.length > 0)
      .map(k => k.toLowerCase().trim())

    return feature
  }
}
