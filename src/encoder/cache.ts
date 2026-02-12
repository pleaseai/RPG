import type { EntityInput, SemanticFeature } from './semantic'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

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

interface Statements {
  get: Database.Statement
  set: Database.Statement
  del: Database.Statement
  clear: Database.Statement
  count: Database.Statement
  purge: Database.Statement
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS semantic_cache (
    key         TEXT PRIMARY KEY,
    feature     TEXT NOT NULL,
    hash        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cache_created ON semantic_cache(created_at);
`

const DEFAULT_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

/**
 * Semantic cache for storing extracted features (SQLite-backed)
 *
 * Caches LLM responses to reduce API calls and costs.
 * Uses content hash to invalidate when source changes.
 * WAL mode for crash-safe incremental writes.
 */
export class SemanticCache {
  private options: Required<CacheOptions>
  private db: Database.Database | null = null
  private _stmts: Statements | null = null

  constructor(options: CacheOptions = {}) {
    this.options = {
      cacheDir: options.cacheDir ?? '.please/cache',
      ttl: options.ttl ?? DEFAULT_TTL,
      enabled: options.enabled ?? true,
    }
  }

  private get stmts(): Statements {
    this.ensureOpen()
    // Safe: ensureOpen() guarantees _stmts is assigned
    return this._stmts as Statements
  }

  /**
   * Get cached feature for entity
   */
  async get(input: EntityInput): Promise<SemanticFeature | null> {
    if (!this.options.enabled)
      return null

    const key = this.generateKey(input)
    const hash = this.generateHash(input)

    const row = this.stmts.get.get(key) as { feature: string, hash: string, created_at: number } | undefined
    if (!row)
      return null

    // Check if hash matches (source hasn't changed)
    if (row.hash !== hash) {
      this.stmts.del.run(key)
      return null
    }

    // Check if expired
    if (Date.now() - row.created_at > this.options.ttl) {
      this.stmts.del.run(key)
      return null
    }

    return JSON.parse(row.feature) as SemanticFeature
  }

  /**
   * Store feature in cache
   */
  async set(input: EntityInput, feature: SemanticFeature): Promise<void> {
    if (!this.options.enabled)
      return

    const key = this.generateKey(input)
    const hash = this.generateHash(input)

    this.stmts.set.run(key, JSON.stringify(feature), hash, Date.now())
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
    if (!this.options.enabled)
      return
    this.stmts.clear.run()
  }

  /**
   * Save cache to disk (no-op for SQLite — writes are immediate)
   */
  async save(): Promise<void> {
    // SQLite writes are immediate via WAL; this method exists for API compatibility.
  }

  /**
   * Purge expired entries
   */
  async purge(): Promise<void> {
    if (!this.options.enabled)
      return
    const expireBefore = Date.now() - this.options.ttl
    this.stmts.purge.run(expireBefore)
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number, enabled: boolean } {
    if (!this.options.enabled) {
      return { size: 0, enabled: this.options.enabled }
    }

    const row = this.stmts.count.get() as { count: number }
    return {
      size: row.count,
      enabled: this.options.enabled,
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      this._stmts = null
    }
  }

  private generateKey(input: EntityInput): string {
    return `${input.filePath}:${input.type}:${input.name}`
  }

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

  private getDbPath(): string {
    return path.join(this.options.cacheDir, 'semantic-cache.db')
  }

  /**
   * Open SQLite database and create schema
   */
  private ensureOpen(): void {
    if (this.db)
      return

    const dir = this.options.cacheDir
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const dbPath = this.getDbPath()
    this.db = new Database(dbPath)

    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')

    this.db.exec(SCHEMA)

    this._stmts = {
      get: this.db.prepare('SELECT feature, hash, created_at FROM semantic_cache WHERE key = ?'),
      set: this.db.prepare(
        `INSERT INTO semantic_cache (key, feature, hash, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET feature = excluded.feature, hash = excluded.hash, created_at = excluded.created_at`,
      ),
      del: this.db.prepare('DELETE FROM semantic_cache WHERE key = ?'),
      clear: this.db.prepare('DELETE FROM semantic_cache'),
      count: this.db.prepare('SELECT COUNT(*) AS count FROM semantic_cache'),
      purge: this.db.prepare('DELETE FROM semantic_cache WHERE created_at < ?'),
    }
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
    const cached = await cache.get(input)
    if (cached) {
      return cached
    }

    const feature = await extractor(input)
    await cache.set(input, feature)

    return feature
  }) as T
}
