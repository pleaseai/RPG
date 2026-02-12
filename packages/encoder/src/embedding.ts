import type { EmbeddingModel } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { embed, embedMany } from 'ai'

// Lazy-loaded types to avoid immediate import
type TransformersModule = typeof import('@huggingface/transformers')
type AutoModelType = Awaited<ReturnType<TransformersModule['AutoModel']['from_pretrained']>>
type AutoTokenizerType = Awaited<ReturnType<TransformersModule['AutoTokenizer']['from_pretrained']>>

/**
 * Embedding vector result
 */
export interface EmbeddingVector {
  /** The embedding vector */
  vector: number[]
  /** Vector dimension */
  dimension: number
}

/**
 * Abstract base class for embedding implementations
 */
export abstract class Embedding {
  protected abstract maxTokens: number

  /**
   * Preprocess text to ensure it's valid for embedding
   */
  protected preprocessText(text: string): string {
    if (text == null || text === '') {
      return ' '
    }

    // Simple character-based truncation (approximately 4 chars per token)
    const maxChars = this.maxTokens * 4
    if (text.length > maxChars) {
      return text.substring(0, maxChars)
    }

    return text
  }

  /**
   * Preprocess array of texts
   */
  protected preprocessTexts(texts: string[]): string[] {
    return texts.map(text => this.preprocessText(text))
  }

  /**
   * Generate embedding vector for text
   */
  abstract embed(text: string): Promise<EmbeddingVector>

  /**
   * Generate embedding vectors for multiple texts in batch
   */
  abstract embedBatch(texts: string[]): Promise<EmbeddingVector[]>

  /**
   * Get embedding vector dimension
   */
  abstract getDimension(): number

  /**
   * Get service provider name
   */
  abstract getProvider(): string
}

/**
 * AI SDK Embedding configuration
 */
export interface AISDKEmbeddingConfig {
  /** AI SDK EmbeddingModel instance */
  model: EmbeddingModel
  /** Vector dimension (0 = auto-detect on first call) */
  dimension?: number
  /** Provider display name (default: 'AISDK') */
  providerName?: string
  /** Max tokens for input truncation (default: 8192) */
  maxTokens?: number
}

/**
 * Generic AI SDK Embedding implementation
 *
 * Accepts any AI SDK EmbeddingModel instance and wraps it in the RPG Embedding interface.
 * Supports all AI SDK providers: @ai-sdk/openai, @ai-sdk/google, voyage-ai-provider, etc.
 *
 * @example
 * ```typescript
 * import { createOpenAI } from '@ai-sdk/openai'
 * const openai = createOpenAI({ apiKey: '...' })
 * const embedding = new AISDKEmbedding({
 *   model: openai.embedding('text-embedding-3-small'),
 *   dimension: 1536,
 * })
 * ```
 */
export class AISDKEmbedding extends Embedding {
  protected maxTokens: number
  private readonly embeddingModel: EmbeddingModel
  private dimension: number
  private readonly providerName: string

  constructor(config: AISDKEmbeddingConfig) {
    super()
    this.embeddingModel = config.model
    this.dimension = config.dimension ?? 0
    this.providerName = config.providerName ?? 'AISDK'
    this.maxTokens = config.maxTokens ?? 8192
  }

  async embed(text: string): Promise<EmbeddingVector> {
    const processedText = this.preprocessText(text)

    try {
      const result = await embed({ model: this.embeddingModel, value: processedText })

      // Always update dimension from the model response to ensure consistency.
      this.dimension = result.embedding.length

      return {
        vector: result.embedding,
        dimension: this.dimension,
      }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to generate ${this.providerName} embedding: ${message}`)
    }
  }

  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    if (texts.length === 0) {
      return []
    }

    const processedTexts = this.preprocessTexts(texts)

    try {
      const result = await embedMany({ model: this.embeddingModel, values: processedTexts })

      if (result.embeddings.length > 0) {
        this.dimension = result.embeddings[0]!.length
      }

      return result.embeddings.map(emb => ({
        vector: emb,
        dimension: this.dimension,
      }))
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to generate ${this.providerName} batch embeddings: ${message}`)
    }
  }

  getDimension(): number {
    return this.dimension
  }

  getProvider(): string {
    return this.providerName
  }
}

/**
 * OpenAI embedding configuration
 */
export interface OpenAIEmbeddingConfig {
  /** OpenAI API key */
  apiKey: string
  /** Model name (default: text-embedding-3-small) */
  model?: string
  /** Custom base URL for API */
  baseURL?: string
}

/**
 * Supported OpenAI embedding models and their dimensions
 */
const OPENAI_MODELS: Record<string, { dimension: number, description: string }> = {
  'text-embedding-3-small': {
    dimension: 1536,
    description: 'High performance and cost-effective embedding model (recommended)',
  },
  'text-embedding-3-large': {
    dimension: 3072,
    description: 'Highest performance embedding model with larger dimensions',
  },
  'text-embedding-ada-002': {
    dimension: 1536,
    description: 'Legacy model (use text-embedding-3-small instead)',
  },
}

/**
 * OpenAI Embedding implementation using AI SDK
 *
 * Uses @ai-sdk/openai with embed()/embedMany() to generate vector embeddings.
 * Supports text-embedding-3-small (default), text-embedding-3-large, and ada-002.
 */
export class OpenAIEmbedding extends Embedding {
  private readonly embeddingModel: EmbeddingModel
  private readonly model: string
  private dimension: number
  protected maxTokens = 8192

  constructor(config: OpenAIEmbeddingConfig) {
    super()
    this.model = config.model ?? 'text-embedding-3-small'
    this.dimension = OPENAI_MODELS[this.model]?.dimension ?? 1536
    const provider = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    })
    this.embeddingModel = provider.embedding(this.model)
  }

  async embed(text: string): Promise<EmbeddingVector> {
    const processedText = this.preprocessText(text)

    try {
      const result = await embed({ model: this.embeddingModel, value: processedText })

      this.dimension = result.embedding.length

      return {
        vector: result.embedding,
        dimension: this.dimension,
      }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to generate OpenAI embedding: ${message}`)
    }
  }

  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    if (texts.length === 0) {
      return []
    }

    const processedTexts = this.preprocessTexts(texts)

    try {
      const result = await embedMany({ model: this.embeddingModel, values: processedTexts })

      if (result.embeddings.length > 0) {
        this.dimension = result.embeddings[0]!.length
      }

      return result.embeddings.map(emb => ({
        vector: emb,
        dimension: this.dimension,
      }))
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to generate OpenAI batch embeddings: ${message}`)
    }
  }

  getDimension(): number {
    return this.dimension
  }

  getProvider(): string {
    return 'OpenAI'
  }

  getModel(): string {
    return this.model
  }

  static getSupportedModels(): Record<string, { dimension: number, description: string }> {
    return { ...OPENAI_MODELS }
  }
}

/**
 * Mock embedding for testing (generates deterministic vectors)
 */
export class MockEmbedding extends Embedding {
  private readonly dimension: number
  protected maxTokens = 8192

  constructor(dimension = 1536) {
    super()
    this.dimension = dimension
  }

  async embed(text: string): Promise<EmbeddingVector> {
    const processedText = this.preprocessText(text)
    return {
      vector: this.generateDeterministicVector(processedText),
      dimension: this.dimension,
    }
  }

  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    const processedTexts = this.preprocessTexts(texts)
    return processedTexts.map(text => ({
      vector: this.generateDeterministicVector(text),
      dimension: this.dimension,
    }))
  }

  getDimension(): number {
    return this.dimension
  }

  getProvider(): string {
    return 'Mock'
  }

  /**
   * Generate a deterministic vector based on text content
   * Same text always produces same vector (for testing)
   */
  private generateDeterministicVector(text: string): number[] {
    const vector: number[] = []
    let hash = 0

    // Simple hash function
    for (let i = 0; i < text.length; i++) {
      const codePoint = text.codePointAt(i) ?? 0
      hash = (hash * 31 + codePoint) % 2147483647
    }

    // Generate deterministic vector values
    for (let i = 0; i < this.dimension; i++) {
      hash = (hash * 1103515245 + 12345) % 2147483648
      // Normalize to [-1, 1] range
      vector.push((hash / 2147483647) * 2 - 1)
    }

    // Normalize to unit vector
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0))
    return vector.map(val => val / magnitude)
  }
}

/**
 * HuggingFace embedding dtype options
 */
export type HuggingFaceDtype = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'

/**
 * HuggingFace embedding configuration
 */
export interface HuggingFaceEmbeddingConfig {
  /** Model ID (default: MongoDB/mdbr-leaf-ir) */
  model?: string
  /** Data type for model weights */
  dtype?: HuggingFaceDtype
  /** Query prefix for IR models */
  queryPrefix?: string
  /** Custom cache directory for model weights */
  cacheDir?: string
}

/**
 * Supported LEAF models and their specifications
 */
const HUGGINGFACE_MODELS: Record<
  string,
  {
    dimension: number
    maxTokens: number
    description: string
    queryPrefix?: string
  }
> = {
  'MongoDB/mdbr-leaf-ir': {
    dimension: 768,
    maxTokens: 512,
    description: 'LEAF model optimized for information retrieval and semantic search (DEFAULT)',
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
  },
  'MongoDB/mdbr-leaf-mt': {
    dimension: 1024,
    maxTokens: 512,
    description: 'LEAF multi-task model for classification, clustering, and sentence similarity',
    queryPrefix: undefined,
  },
}

/**
 * HuggingFace Embedding implementation using MongoDB LEAF models
 *
 * Uses @huggingface/transformers to run embedding models locally.
 * Supports MongoDB/mdbr-leaf-ir (IR) and MongoDB/mdbr-leaf-mt (MT) models.
 *
 * @example
 * ```typescript
 * const embedding = new HuggingFaceEmbedding({
 *   model: 'MongoDB/mdbr-leaf-ir',
 *   dtype: 'fp32',
 * })
 * await embedding.preload() // Optional: eager load
 * const result = await embedding.embed('Hello, world!')
 * ```
 */
export class HuggingFaceEmbedding extends Embedding {
  protected maxTokens = 512
  private model: AutoModelType | null = null
  private tokenizer: AutoTokenizerType | null = null
  private dimension = 768
  private config: HuggingFaceEmbeddingConfig
  private modelLoading: Promise<void> | null = null
  private transformersModule: TransformersModule | null = null

  constructor(config: HuggingFaceEmbeddingConfig = {}) {
    super()
    this.config = {
      model: config.model ?? 'MongoDB/mdbr-leaf-ir',
      dtype: config.dtype ?? 'fp32',
      queryPrefix: config.queryPrefix,
      cacheDir: config.cacheDir,
    }

    // Set dimension and query prefix based on model
    const modelId = this.config.model ?? 'MongoDB/mdbr-leaf-ir'
    const modelInfo = HUGGINGFACE_MODELS[modelId]
    if (modelInfo) {
      this.dimension = modelInfo.dimension
      this.maxTokens = modelInfo.maxTokens
      // Use model-specific query prefix if not overridden
      if (this.config.queryPrefix === undefined) {
        this.config.queryPrefix = modelInfo.queryPrefix
      }
    }
  }

  static getSupportedModels(): Record<
    string,
    {
      dimension: number
      maxTokens: number
      description: string
      queryPrefix?: string
    }
  > {
    return { ...HUGGINGFACE_MODELS }
  }

  private async getTransformersModule(): Promise<TransformersModule> {
    if (!this.transformersModule) {
      this.transformersModule = await import('@huggingface/transformers')

      // Configure cache directory if specified
      if (this.config.cacheDir) {
        this.transformersModule.env.cacheDir = this.config.cacheDir
      }
    }
    return this.transformersModule
  }

  private async ensureModel(): Promise<void> {
    if (this.model && this.tokenizer) {
      return
    }

    if (this.modelLoading) {
      await this.modelLoading
      return
    }

    this.modelLoading = this.loadModel()
    await this.modelLoading
  }

  private async loadModel(): Promise<void> {
    try {
      const transformers = await this.getTransformersModule()
      const modelId = this.config.model ?? 'MongoDB/mdbr-leaf-ir'

      console.log(`[HuggingFace] Loading model: ${modelId} (dtype: ${this.config.dtype})`)

      const [tokenizer, model] = await Promise.all([
        transformers.AutoTokenizer.from_pretrained(modelId),
        transformers.AutoModel.from_pretrained(modelId, {
          dtype: this.config.dtype,
        }),
      ])

      this.tokenizer = tokenizer
      this.model = model

      console.log(`[HuggingFace] Model loaded successfully: ${modelId}`)
    }
    catch (error) {
      this.modelLoading = null
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      const err = new Error(
        `Failed to load HuggingFace model ${this.config.model}: ${errorMessage}`,
      )
      ;(err as Error & { cause?: unknown }).cause = error
      throw err
    }
  }

  private applyQueryPrefix(text: string): string {
    if (this.config.queryPrefix) {
      return this.config.queryPrefix + text
    }
    return text
  }

  async detectDimension(): Promise<number> {
    return this.dimension
  }

  async embed(text: string): Promise<EmbeddingVector> {
    await this.ensureModel()

    if (!this.model || !this.tokenizer) {
      throw new Error('Model or tokenizer failed to initialize')
    }

    const processedText = this.preprocessText(text)
    const prefixedText = this.applyQueryPrefix(processedText)

    try {
      const inputs = await this.tokenizer([prefixedText], {
        padding: true,
        truncation: true,
        max_length: this.maxTokens,
      })

      const outputs = await this.model(inputs)

      if (!outputs.sentence_embedding) {
        throw new Error('Model did not return sentence_embedding')
      }

      const embedding = outputs.sentence_embedding.tolist()[0] as number[]

      return {
        vector: embedding,
        dimension: embedding.length,
      }
    }
    catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      const err = new Error(`HuggingFace embedding failed: ${errorMessage}`)
      ;(err as Error & { cause?: unknown }).cause = error
      throw err
    }
  }

  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    if (texts.length === 0) {
      return []
    }

    await this.ensureModel()

    if (!this.model || !this.tokenizer) {
      throw new Error('Model or tokenizer failed to initialize')
    }

    const processedTexts = this.preprocessTexts(texts)
    const prefixedTexts = processedTexts.map(text => this.applyQueryPrefix(text))

    try {
      const inputs = await this.tokenizer(prefixedTexts, {
        padding: true,
        truncation: true,
        max_length: this.maxTokens,
      })

      const outputs = await this.model(inputs)

      if (!outputs.sentence_embedding) {
        throw new Error('Model did not return sentence_embedding')
      }

      const embeddings = outputs.sentence_embedding.tolist() as number[][]

      return embeddings.map(embedding => ({
        vector: embedding,
        dimension: embedding.length,
      }))
    }
    catch (error) {
      // Fallback: process individually in parallel if batch fails
      const batchErrorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.warn(
        `[HuggingFace] Batch embedding failed: ${batchErrorMessage}, falling back to parallel individual processing`,
      )

      try {
        return await Promise.all(texts.map(text => this.embed(text)))
      }
      catch (individualError) {
        const err = new Error(
          `HuggingFace batch embedding failed (both batch and individual attempts failed): ${batchErrorMessage}`,
        )
        ;(err as Error & { cause?: unknown }).cause = individualError
        throw err
      }
    }
  }

  getDimension(): number {
    return this.dimension
  }

  getProvider(): string {
    return 'HuggingFace'
  }

  getModel(): string {
    return this.config.model ?? 'MongoDB/mdbr-leaf-ir'
  }

  getDtype(): HuggingFaceDtype {
    return this.config.dtype ?? 'fp32'
  }

  getQueryPrefix(): string | undefined {
    return this.config.queryPrefix
  }

  isModelLoaded(): boolean {
    return this.model !== null && this.tokenizer !== null
  }

  async preload(): Promise<void> {
    await this.ensureModel()
  }
}
