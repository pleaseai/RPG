import type { EntityInput, SemanticFeature } from './semantic'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Cache options
 */
export interface CacheOptions {
  /** Cache directory path */
  cacheDir?: string
  /** Time-to-live in milliseconds (default: 7 days) */
  ttl?: number
  /** Enable caching */
  enabled?: boolean
}

/**
 * Cache entry structure
 */
interface CacheEntry {
  feature: SemanticFeature
  createdAt: number
  hash: string
}

/**
 * Cache file structure
 */
interface CacheFile {
  version: string
  entries: Record<string, CacheEntry>
}

const CACHE_VERSION = '1.0.0'
const DEFAULT_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

/**
 * Semantic cache for storing extracted features
 *
 * Caches LLM responses to reduce API calls and costs.
 * Uses content hash to invalidate when source changes.
 */
export class SemanticCache {
  private options: Required<CacheOptions>
  private cache: Map<string, CacheEntry> = new Map()
  private dirty = false

  constructor(options: CacheOptions = {}) {
    this.options = {
      cacheDir: options.cacheDir ?? '.please/cache',
      ttl: options.ttl ?? DEFAULT_TTL,
      enabled: options.enabled ?? true,
    }
  }

  /**
   * Get cached feature for entity
   */
  async get(input: EntityInput): Promise<SemanticFeature | null> {
    if (!this.options.enabled)
      return null

    await this.ensureLoaded()

    const key = this.generateKey(input)
    const hash = this.generateHash(input)

    const entry = this.cache.get(key)
    if (!entry)
      return null

    // Check if hash matches (source hasn't changed)
    if (entry.hash !== hash) {
      this.cache.delete(key)
      this.dirty = true
      return null
    }

    // Check if expired
    if (Date.now() - entry.createdAt > this.options.ttl) {
      this.cache.delete(key)
      this.dirty = true
      return null
    }

    return entry.feature
  }

  /**
   * Store feature in cache
   */
  async set(input: EntityInput, feature: SemanticFeature): Promise<void> {
    if (!this.options.enabled)
      return

    await this.ensureLoaded()

    const key = this.generateKey(input)
    const hash = this.generateHash(input)

    this.cache.set(key, {
      feature,
      createdAt: Date.now(),
      hash,
    })

    this.dirty = true
  }

  /**
   * Check if entity is cached
   */
  async has(input: EntityInput): Promise<boolean> {
    const cached = await this.get(input)
    return cached !== null
  }

  /**
   * Clear all cached entries
   */
  async clear(): Promise<void> {
    this.cache.clear()
    this.dirty = true
    await this.save()
  }

  /**
   * Save cache to disk
   */
  async save(): Promise<void> {
    if (!this.options.enabled || !this.dirty)
      return

    const cacheFile: CacheFile = {
      version: CACHE_VERSION,
      entries: Object.fromEntries(this.cache),
    }

    const filePath = this.getCacheFilePath()
    const dir = path.dirname(filePath)

    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }

    await writeFile(filePath, JSON.stringify(cacheFile, null, 2))
    this.dirty = false
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number, enabled: boolean } {
    return {
      size: this.cache.size,
      enabled: this.options.enabled,
    }
  }

  /**
   * Generate cache key from entity
   */
  private generateKey(input: EntityInput): string {
    return `${input.filePath}:${input.type}:${input.name}`
  }

  /**
   * Generate content hash for invalidation
   */
  private generateHash(input: EntityInput): string {
    const content = [
      input.filePath,
      input.type,
      input.name,
      input.parent ?? '',
      input.sourceCode ?? '',
      input.documentation ?? '',
    ].join('|')

    return createHash('md5').update(content).digest('hex').substring(0, 16)
  }

  /**
   * Get cache file path
   */
  private getCacheFilePath(): string {
    return path.join(this.options.cacheDir, 'semantic-cache.json')
  }

  /**
   * Ensure cache is loaded from disk
   */
  private loaded = false
  private async ensureLoaded(): Promise<void> {
    if (this.loaded)
      return

    const filePath = this.getCacheFilePath()

    if (existsSync(filePath)) {
      try {
        const content = await readFile(filePath, 'utf-8')
        const cacheFile: CacheFile = JSON.parse(content)

        // Check version compatibility
        if (cacheFile.version === CACHE_VERSION) {
          this.cache = new Map(Object.entries(cacheFile.entries))
        }
      }
      catch {
        // Ignore errors, start with empty cache
      }
    }

    this.loaded = true
  }
}

/**
 * Create a cached semantic extractor wrapper
 */
export function createCachedExtractor<T extends (input: EntityInput) => Promise<SemanticFeature>>(
  extractor: T,
  cache: SemanticCache,
): T {
  return (async (input: EntityInput) => {
    // Try cache first
    const cached = await cache.get(input)
    if (cached) {
      return cached
    }

    // Extract and cache
    const feature = await extractor(input)
    await cache.set(input, feature)

    return feature
  }) as T
}
