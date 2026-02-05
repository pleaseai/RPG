import type { LLMProvider } from '../utils/llm'
import { LLMClient } from '../utils/llm'

/**
 * Options for semantic extraction
 */
export interface SemanticOptions {
  /** LLM provider to use */
  provider?: LLMProvider
  /** API key (defaults to environment variable) */
  apiKey?: string
  /** Whether to use LLM for semantic extraction (if false, uses heuristic) */
  useLLM?: boolean
  /** Maximum tokens per request */
  maxTokens?: number
}

/**
 * Semantic feature generated for an entity
 */
export interface SemanticFeature {
  /** Primary description (verb + object format) */
  description: string
  /** Additional sub-features */
  subFeatures?: string[]
  /** Keywords for search */
  keywords: string[]
}

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
  private llmClient?: LLMClient
  private options: SemanticOptions

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
          apiKey: this.options.apiKey,
          maxTokens: this.options.maxTokens,
        })
      }
    }
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
      catch {
        // Fall back to heuristic on error
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
   * Extract semantic features using LLM
   */
  private async extractWithLLM(input: EntityInput): Promise<SemanticFeature> {
    const prompt = this.buildPrompt(input)
    const systemPrompt = `You are a code analysis assistant. Extract semantic features from code entities.
Always respond with valid JSON in this exact format:
{
  "description": "verb + object format description (e.g., 'handle user authentication')",
  "subFeatures": ["optional", "sub-features"],
  "keywords": ["relevant", "search", "keywords"]
}
Focus on WHAT the code does, not HOW it does it.
Use verb + object format for descriptions (e.g., "validate user input", "fetch data from API").`

    const response = await this.llmClient?.completeJSON<SemanticFeature>(prompt, systemPrompt)
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

    return {
      description,
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
        return `class representing ${name}`
      case 'method':
        return input.parent ? `method to ${name} in ${input.parent}` : `method to ${name}`
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
      ['handle', 'handle'],
      ['process', 'process'],
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
      ['run', 'run'],
      ['execute', 'execute'],
      ['on', 'handle'],
    ]

    for (const [prefix, verb] of verbPatterns) {
      if (lowerName.startsWith(prefix)) {
        const rest = name.substring(prefix.length).trim()
        if (rest) {
          return `${verb} ${rest.toLowerCase()}`
        }
      }
    }

    // Default: assume function does what its name says
    return `function that ${name}`
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
      return `${humanName} module in ${dirName}`
    }
    return `${humanName} module`
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
   * Validate and normalize LLM response
   */
  private validateFeature(feature: SemanticFeature, input: EntityInput): SemanticFeature {
    // Ensure required fields exist
    if (!feature.description || typeof feature.description !== 'string') {
      feature.description = this.generateDescription(input)
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
