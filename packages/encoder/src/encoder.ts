import type { CodeEntity, ParseResult } from '@pleaseai/soop-ast'
import type { RPGConfig } from '@pleaseai/soop-graph'
import type { LowLevelNode } from '@pleaseai/soop-graph/node'
import type { LLMProvider, TokenUsageStats } from '@pleaseai/soop-utils/llm'
import type { CacheOptions } from './cache'
import type { FileParseInfo } from './data-flow'
import type { EvolutionResult } from './evolution/types'
import type { FileFeatureGroup } from './reorganization'
import type { EntityInput, SemanticFeature, SemanticOptions } from './semantic'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ASTParser } from '@pleaseai/soop-ast'
import { RepositoryPlanningGraph } from '@pleaseai/soop-graph'
import { getHeadCommitSha } from '@pleaseai/soop-utils/git-helpers'
import { resolveGitBinary } from '@pleaseai/soop-utils/git-path'
import { LLMClient } from '@pleaseai/soop-utils/llm'
import { createLogger } from '@pleaseai/soop-utils/logger'
import { SemanticCache } from './cache'
import { DataFlowDetector } from './data-flow'
import { injectDependencies } from './dependency-injection'
import { RPGEvolver } from './evolution/evolve'
import { ArtifactGrounder } from './grounding'
import { DomainDiscovery, HierarchyBuilder } from './reorganization'
import { buildAnalyzeDataFlowPrompt, buildExcludeFilesPrompt, buildGenerateRepoInfoPrompt } from './reorganization/prompts'
import { SemanticExtractor } from './semantic'

const log = createLogger('RPGEncoder')
const logDiscover = createLogger('discoverFiles')

/**
 * Options for encoding a repository
 */
export interface EncoderOptions {
  /** Repository path */
  repoPath: string
  /** Include source code in nodes */
  includeSource?: boolean
  /** File patterns to include */
  include?: string[]
  /** File patterns to exclude */
  exclude?: string[]
  /** Maximum depth for directory traversal */
  maxDepth?: number
  /** Respect .gitignore rules via git ls-files (default: true) */
  respectGitignore?: boolean
  /** Semantic extraction options */
  semantic?: SemanticOptions
  /** Cache options */
  cache?: CacheOptions
  /** Pre-computed repository info (skip LLM call if provided) */
  repoInfo?: string
  /** Whether to generate repo info using LLM at encode start (default: true when LLM enabled) */
  generateRepoInfo?: boolean
  /** Whether to use LLM to exclude irrelevant files (default: false to avoid accidental exclusions) */
  excludeWithLLM?: boolean
}

/**
 * Result of encoding a repository
 */
export interface EncodingResult {
  /** The generated RPG */
  rpg: RepositoryPlanningGraph
  /** Number of files processed */
  filesProcessed: number
  /** Number of functions/classes extracted */
  entitiesExtracted: number
  /** Time taken in milliseconds */
  duration: number
  /** Non-fatal warnings collected during encoding (e.g. grounding failures) */
  warnings?: string[]
}

// ==================== Shared Utility Functions ====================

/**
 * Options for file discovery
 */
export interface DiscoverFilesOptions {
  include?: string[]
  exclude?: string[]
  maxDepth?: number
  /** Respect .gitignore rules via git ls-files (default: true) */
  respectGitignore?: boolean
}

/**
 * List files known to git: tracked + untracked-but-not-ignored.
 * Returns relative paths (forward-slash separated).
 * Returns empty array for non-git directories or on failure (with warning).
 */
function gitListFiles(repoPath: string): string[] {
  let gitBinary: string
  try {
    gitBinary = resolveGitBinary()
  }
  catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logDiscover.warn(
      `git binary not available: ${msg}. Cannot check .gitignore rules; falling back to directory walk.`,
    )
    return []
  }

  try {
    const stdout = execFileSync(
      gitBinary,
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: 'pipe',
        maxBuffer: 10 * 1024 * 1024, // 10MB
      },
    )
    return [...new Set(stdout.split('\0').filter(Boolean))]
  }
  catch (error: unknown) {
    const err = error as { status?: number, code?: string, stderr?: string }
    const stderr = (err.stderr ?? '').trim()
    if (err.status === 128 && stderr.includes('not a git repository')) {
      // Normal "not a git repo" response — no warning needed
    }
    else {
      logDiscover.warn(
        `git ls-files failed`
        + ` (exit ${err.status ?? '?'}, code=${err.code ?? 'unknown'}): `
        + `${stderr || (error instanceof Error ? error.message : String(error))}. `
        + `Falling back to directory walk (gitignore rules will NOT be applied).`,
      )
    }
    return []
  }
}

function filterGitFiles(
  repoPath: string,
  gitFiles: string[],
  includePatterns: string[],
  excludePatterns: string[],
  maxDepth: number,
): string[] {
  return gitFiles
    .filter((relativePath) => {
      const normalizedPath = relativePath.replaceAll('\\', '/')
      const depth = normalizedPath.split('/').length - 1
      return depth <= maxDepth
        && !matchesPattern(normalizedPath, excludePatterns)
        && matchesPattern(normalizedPath, includePatterns)
    })
    .map(relativePath => path.join(repoPath, relativePath))
}

/**
 * Discover files in a repository matching the given patterns.
 *
 * When respectGitignore is true (default), uses `git ls-files` to respect
 * .gitignore rules. Falls back to walkDirectory for non-git repos, when
 * git is unavailable, or when respectGitignore is false.
 *
 * Shared between RPGEncoder and interactive encoder.
 */
export async function discoverFiles(
  repoPath: string,
  opts?: DiscoverFilesOptions,
): Promise<string[]> {
  if (!fs.existsSync(repoPath)) {
    throw new Error(`Repository path does not exist: ${repoPath}`)
  }

  const includePatterns = opts?.include ?? [
    '**/*.ts',
    '**/*.tsx',
    '**/*.js',
    '**/*.jsx',
    '**/*.py',
    '**/*.rs',
    '**/*.go',
    '**/*.java',
    '**/*.cs',
    '**/*.c',
    '**/*.h',
    '**/*.cpp',
    '**/*.cc',
    '**/*.cxx',
    '**/*.hpp',
    '**/*.hxx',
    '**/*.rb',
    '**/*.kt',
    '**/*.kts',
  ]
  const excludePatterns = opts?.exclude ?? [
    '**/node_modules/**',
    '**/dist/**',
    '**/.git/**',
  ]
  const maxDepth = opts?.maxDepth ?? 10
  const respectGitignore = opts?.respectGitignore !== false

  if (respectGitignore) {
    const gitFiles = gitListFiles(repoPath)
    if (gitFiles.length > 0) {
      const filtered = filterGitFiles(repoPath, gitFiles, includePatterns, excludePatterns, maxDepth)
      if (filtered.length === 0) {
        logDiscover.warn(
          `git ls-files found ${gitFiles.length} files, `
          + `but 0 matched the configured filters (include/exclude/maxDepth). `
          + 'Please check your configuration.',
        )
      }
      return filtered.sort((a, b) => a.localeCompare(b))
    }
  }

  const files: string[] = []
  await walkDirectory(repoPath, repoPath, files, includePatterns, excludePatterns, 0, maxDepth)

  return files.sort((a, b) => a.localeCompare(b))
}

async function walkDirectory(
  rootPath: string,
  dir: string,
  files: string[],
  includePatterns: string[],
  excludePatterns: string[],
  depth: number,
  maxDepth: number,
): Promise<void> {
  if (depth > maxDepth)
    return

  const entries = await readDirSafe(dir)
  if (!entries)
    return

  for (const entry of entries) {
    await processEntry(rootPath, dir, entry, files, includePatterns, excludePatterns, depth, maxDepth)
  }
}

async function readDirSafe(dir: string): Promise<string[] | null> {
  try {
    return await readdir(dir)
  }
  catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logDiscover.warn(`Skipping directory ${dir}: ${msg}`)
    return null
  }
}

async function processEntry(
  rootPath: string,
  dir: string,
  entry: string,
  files: string[],
  includePatterns: string[],
  excludePatterns: string[],
  depth: number,
  maxDepth: number,
): Promise<void> {
  const fullPath = path.join(dir, entry)
  const relativePath = path.relative(rootPath, fullPath)

  if (matchesPattern(relativePath, excludePatterns))
    return

  let stats: fs.Stats
  try {
    stats = await stat(fullPath)
  }
  catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logDiscover.warn(`Skipping ${fullPath}: ${msg}`)
    return
  }

  if (stats.isDirectory()) {
    await walkDirectory(rootPath, fullPath, files, includePatterns, excludePatterns, depth + 1, maxDepth)
  }
  else if (stats.isFile() && matchesPattern(relativePath, includePatterns)) {
    files.push(fullPath)
  }
}

function matchesPattern(filePath: string, patterns: string[]): boolean {
  return patterns.some(pattern => globMatch(filePath, pattern))
}

function globMatch(filePath: string, pattern: string): boolean {
  const normalizedPath = filePath.replaceAll('\\', '/')
  const normalizedPattern = pattern.replaceAll('\\', '/')
  const pathSegments = normalizedPath.split('/')
  const patternSegments = normalizedPattern.split('/')
  return matchSegments(pathSegments, patternSegments, 0, 0)
}

function matchSegments(
  pathSegs: string[],
  patternSegs: string[],
  pathIdx: number,
  patternIdx: number,
): boolean {
  if (pathIdx === pathSegs.length && patternIdx === patternSegs.length) {
    return true
  }
  if (patternIdx === patternSegs.length) {
    return false
  }

  const patternSeg = patternSegs[patternIdx]
  if (patternSeg === undefined)
    return false

  if (patternSeg === '**') {
    for (let i = pathIdx; i <= pathSegs.length; i++) {
      if (matchSegments(pathSegs, patternSegs, i, patternIdx + 1)) {
        return true
      }
    }
    return false
  }

  if (pathIdx === pathSegs.length) {
    return false
  }

  const pathSeg = pathSegs[pathIdx]
  if (pathSeg && matchSegment(pathSeg, patternSeg)) {
    return matchSegments(pathSegs, patternSegs, pathIdx + 1, patternIdx + 1)
  }

  return false
}

function matchSegment(pathSeg: string, patternSeg: string): boolean {
  const regexPattern = patternSeg
    .replaceAll('.', '\\.') // Escape dots
    .replaceAll('*', '.*') // * matches anything
    .replaceAll('?', '.') // ? matches single char
  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(pathSeg)
}

/**
 * Generate a unique entity ID from file path and entity metadata.
 *
 * Shared between RPGEncoder and interactive encoder.
 */
export function generateEntityId(
  filePath: string,
  entityType: string,
  entityName?: string,
  startLine?: number,
): string {
  const parts = [filePath, entityType]
  if (entityName) {
    parts.push(entityName)
  }
  if (startLine !== undefined) {
    parts.push(String(startLine))
  }
  return parts.join(':')
}

/**
 * Result of extracting entities from a single file via AST parsing
 */
export interface FileEntityExtractionResult {
  /** File path relative to repo root */
  relativePath: string
  /** File source code */
  sourceCode: string | undefined
  /** AST parse result (entities + imports) */
  parseResult: ParseResult
  /** Entities extracted with their IDs and source code slices */
  entities: Array<{
    id: string
    codeEntity: CodeEntity
    entityType: 'file' | 'class' | 'function' | 'method'
    sourceCode: string | undefined
  }>
  /** The file-level entity ID */
  fileEntityId: string
}

/**
 * Map AST entity type to RPG entity type
 */
function mapEntityType(type: CodeEntity['type']): 'file' | 'class' | 'function' | 'method' | null {
  const typeMap: Record<string, 'file' | 'class' | 'function' | 'method'> = {
    function: 'function',
    class: 'class',
    method: 'method',
  }
  return typeMap[type] ?? null
}

/**
 * Extract entities from a file using AST parsing.
 *
 * Returns code entities with their IDs and source code slices,
 * but without semantic features (those are added separately).
 *
 * Shared between RPGEncoder and interactive encoder.
 */
export async function extractEntitiesFromFile(
  filePath: string,
  repoPath: string,
  astParser: ASTParser,
): Promise<FileEntityExtractionResult> {
  const relativePath = path.relative(repoPath, filePath)

  let sourceCode: string | undefined
  try {
    sourceCode = await readFile(filePath, 'utf-8')
  }
  catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log.warn(`Cannot read ${filePath}: ${msg}`)
  }

  const parseResult = await astParser.parseFile(filePath)

  const fileEntityId = generateEntityId(relativePath, 'file')
  const entities: FileEntityExtractionResult['entities'] = []
  const sourceLines = sourceCode?.split('\n')

  for (const codeEntity of parseResult.entities) {
    const entityType = mapEntityType(codeEntity.type)
    if (!entityType)
      continue

    const entityId = generateEntityId(
      relativePath,
      codeEntity.type,
      codeEntity.name,
      codeEntity.startLine,
    )

    let entitySourceCode: string | undefined
    if (sourceLines && codeEntity.startLine !== undefined && codeEntity.endLine !== undefined) {
      entitySourceCode = sourceLines.slice(codeEntity.startLine - 1, codeEntity.endLine).join('\n')
    }

    entities.push({
      id: entityId,
      codeEntity,
      entityType,
      sourceCode: entitySourceCode,
    })
  }

  return {
    relativePath,
    sourceCode,
    parseResult,
    entities,
    fileEntityId,
  }
}

// Re-export from dependency-injection module
export { injectDependencies, resolveImportPath } from './dependency-injection'

// ==================== RPGEncoder Class ====================

/**
 * RPG Encoder - Extracts RPG from existing codebases
 *
 * Implements three phases:
 * 1. Semantic Lifting: Extract semantic features from code
 * 2. Structural Reorganization: Build functional hierarchy
 * 3. Artifact Grounding: Connect to physical code entities
 */
/**
 * Entity extracted from a file
 */
interface ExtractedEntity {
  id: string
  feature: SemanticFeature
  metadata: {
    entityType: 'file' | 'class' | 'function' | 'method'
    path: string
    startLine?: number
    endLine?: number
  }
  sourceCode?: string
}

interface ExtractionResult {
  entities: ExtractedEntity[]
  fileToChildEdges: Array<{ source: string, target: string }>
  parseResult: ParseResult
  sourceCode?: string
  relativePath: string
  /** Deferred file summary data for batch LLM aggregation (Gap 4) */
  pendingFileSummary?: {
    fileEntityId: string
    fileName: string
    filePath: string
    childFeatures: SemanticFeature[]
    /** Enriched entity info for richer LLM prompts (Gap 4-A) */
    childEntities: Array<{ name: string, type: string, feature: SemanticFeature }>
  }
}

export class RPGEncoder {
  private readonly repoPath: string
  private readonly options: EncoderOptions
  private readonly astParser: ASTParser
  private readonly semanticExtractor: SemanticExtractor
  private readonly llmClient: LLMClient | null = null
  private readonly cache: SemanticCache
  private cacheHits = 0
  private cacheMisses = 0
  private _rpg: RepositoryPlanningGraph | null = null

  /** Access the RPG instance (set after encode(), evolve(), or fromSaved()) */
  get rpg(): RepositoryPlanningGraph | null {
    return this._rpg
  }

  /**
   * Load RPGEncoder from a saved RPG JSON file.
   *
   * Mirrors the reference RPGEncoder.from_saved() pattern:
   *   const encoder = await RPGEncoder.fromSaved("rpg.json", "/path/to/repo")
   *   const result = await encoder.evolve({ commitRange: "HEAD~1..HEAD" })
   *   await encoder.save("rpg.json")
   */
  static async fromSaved(
    savePath: string,
    repoPath?: string,
    options?: Partial<Omit<EncoderOptions, 'repoPath'>>,
  ): Promise<RPGEncoder> {
    let graphJson: string
    try {
      graphJson = await readFile(savePath, 'utf-8')
    }
    catch (error) {
      throw new Error(`Could not read RPG file "${savePath}": ${error instanceof Error ? error.message : error}`)
    }

    // Try to read companion .meta.json
    const { metaPathFor } = await import('@pleaseai/soop-graph/meta')
    const metaPath = metaPathFor(savePath)
    let metaJson: string | undefined
    try {
      metaJson = await readFile(metaPath, 'utf-8')
    }
    catch (metaError) {
      const code = (metaError as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        log.warn(`Could not read meta file at "${metaPath}": ${metaError instanceof Error ? metaError.message : String(metaError)}`)
      }
      // meta file is optional
    }

    let rpg: RepositoryPlanningGraph
    try {
      const isJsonl = savePath.endsWith('.jsonl')
      if (isJsonl) {
        rpg = metaJson
          ? await RepositoryPlanningGraph.fromJSONLWithMeta(graphJson, metaJson, undefined, savePath)
          : await RepositoryPlanningGraph.fromJSONL(graphJson)
      }
      else {
        rpg = metaJson
          ? await RepositoryPlanningGraph.fromJSONWithMeta(graphJson, metaJson, undefined, savePath)
          : await RepositoryPlanningGraph.fromJSON(graphJson)
      }
    }
    catch (error) {
      throw new Error(`Could not parse RPG file "${savePath}": ${error instanceof Error ? error.message : error}`)
    }
    const savedRootPath = rpg.getConfig().rootPath
    const resolvedPath = repoPath ?? (savedRootPath
      ? (path.isAbsolute(savedRootPath) ? savedRootPath : path.resolve(path.dirname(savePath), savedRootPath))
      : '.')
    const encoder = new RPGEncoder(resolvedPath, options)
    encoder._rpg = rpg
    log.info(`Loaded RPG from ${savePath}: ${(await rpg.getStats()).nodeCount} nodes`)
    return encoder
  }

  /**
   * Save the current RPG to disk.
   * Writes graph file (JSON or JSONL) and companion .meta.json.
   * Automatically stamps the HEAD commit SHA into the meta file.
   *
   * Format is auto-detected from file extension: `.jsonl` → JSONL, otherwise JSON.
   */
  async save(savePath: string): Promise<void> {
    if (!this._rpg) {
      throw new Error('No RPG to save. Call encode() first.')
    }
    try {
      const headSha = getHeadCommitSha(path.resolve(this.repoPath))
      const cfg = this._rpg.getConfig()
      this._rpg.updateConfig({
        github: {
          owner: cfg.github?.owner ?? '',
          repo: cfg.github?.repo ?? cfg.name,
          commit: headSha,
          pathPrefix: cfg.github?.pathPrefix,
        },
      })
    }
    catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes('not a git repository') || msg.includes('ENOENT')) {
        log.debug('Not a git directory — skipping commit stamp')
      }
      else {
        throw new Error(`Failed to stamp HEAD commit: ${msg}`)
      }
    }

    const { metaPathFor } = await import('@pleaseai/soop-graph/meta')
    const useJsonl = savePath.endsWith('.jsonl')

    if (useJsonl) {
      const { graphJsonl, metaJson } = await this._rpg.toJSONLWithMeta(savePath)
      await writeFile(savePath, graphJsonl)
      await writeFile(metaPathFor(savePath), metaJson)
    }
    else {
      const { graphJson, metaJson } = await this._rpg.toJSONWithMeta(savePath)
      await writeFile(savePath, graphJson)
      await writeFile(metaPathFor(savePath), metaJson)
    }
    log.info(`Saved RPG to ${savePath}`)
  }

  /**
   * Write the vendor-schema dependency graph as a sidecar JSON file.
   *
   * Mirrors RPG-Kit `run_encode.py` Step 2 (lines 98-140): emits a
   * standalone `dep_graph.json` next to the RPG output and records its
   * relative path on the RPG so that the next `save()` includes a
   * `dep_graph_file` reference.
   *
   * Returns the absolute path of the file written.
   */
  async writeDepGraph(
    depGraphPath: string,
    options?: { rpgPath?: string },
  ): Promise<string> {
    if (!this._rpg) {
      throw new Error('No RPG to serialize. Call encode() first.')
    }
    const { toVendorDepGraph } = await import('./vendor-dep-graph')
    const data = await toVendorDepGraph(this._rpg, {
      repoDir: path.resolve(this.repoPath),
      repoName: this._rpg.getConfig().name,
    })
    await writeFile(depGraphPath, `${JSON.stringify(data, null, 2)}\n`)

    // Store a relative reference so the next save() emits dep_graph_file.
    if (options?.rpgPath) {
      const rel = path.relative(path.dirname(options.rpgPath), depGraphPath)
      this._rpg.setDepGraphFile(rel)
    }

    log.info(`Wrote dep_graph.json to ${depGraphPath}`)
    return depGraphPath
  }

  constructor(repoPath: string, options?: Partial<Omit<EncoderOptions, 'repoPath'>>) {
    this.repoPath = repoPath
    this.astParser = new ASTParser()
    if (!this.astParser.isAvailable()) {
      log.warn('tree-sitter not available — AST parsing and dependency edges will be skipped')
    }
    this.options = {
      repoPath,
      includeSource: false,
      include: [
        '**/*.ts',
        '**/*.tsx',
        '**/*.js',
        '**/*.jsx',
        '**/*.py',
        '**/*.rs',
        '**/*.go',
        '**/*.java',
        '**/*.cs',
        '**/*.c',
        '**/*.h',
        '**/*.cpp',
        '**/*.cc',
        '**/*.cxx',
        '**/*.hpp',
        '**/*.hxx',
        '**/*.rb',
        '**/*.kt',
        '**/*.kts',
      ],
      exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
      maxDepth: 10,
      ...options,
    }

    // Initialize semantic extractor and cache
    this.semanticExtractor = new SemanticExtractor(this.options.semantic)
    this.cache = new SemanticCache({
      cacheDir: path.join(this.repoPath, '.rpg', 'cache'),
      ...this.options.cache,
    })

    // Initialize shared LLM client for reorganization module
    this.llmClient = this.createLLMClient()

    // Log LLM configuration
    const provider = this.llmClient?.getProvider()
    const model = this.llmClient?.getModel()
    if (provider) {
      log.info(`LLM: ${provider} (${model})`)
    }
    else {
      log.info('LLM: disabled (heuristic mode)')
    }
  }

  private createLLMClient(): LLMClient | null {
    const semantic = this.options.semantic
    if (semantic?.useLLM === false)
      return null

    let detectedProvider: LLMProvider | null = null
    if (process.env.GOOGLE_GENERATIVE_AI_API_KEY)
      detectedProvider = 'google'
    else if (process.env.ANTHROPIC_API_KEY)
      detectedProvider = 'anthropic'
    else if (process.env.OPENAI_API_KEY)
      detectedProvider = 'openai'
    const provider = semantic?.provider ?? detectedProvider

    if (!provider)
      return null

    return new LLMClient({
      provider,
      model: semantic?.model,
      apiKey: semantic?.apiKey,
      maxTokens: semantic?.maxTokens,
      claudeCodeSettings: semantic?.claudeCodeSettings,
      codexSettings: semantic?.codexSettings,
      googleSettings: semantic?.googleSettings,
    })
  }

  /**
   * Generate a concise repository overview using the LLM.
   * Falls back to README excerpt or repo name when LLM is unavailable.
   */
  private async generateRepoInfo(): Promise<string> {
    const repoName = (this.repoPath.split('/').pop() ?? 'unknown').toLowerCase()

    // Read README if available
    let readmeContent = ''
    for (const readmeName of ['README.md', 'README.rst', 'README.txt', 'README']) {
      try {
        const readmePath = path.join(this.repoPath, readmeName)
        readmeContent = await readFile(readmePath, 'utf-8')
        break
      }
      catch (error) {
        log.debug(`README not found at ${readmeName}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Build repo skeleton (file listing, truncated)
    const skeleton = await this.buildRepoSkeleton()

    if (!this.llmClient) {
      // No LLM — return basic info from README or repo name
      return readmeContent.slice(0, 500) || `Repository: ${repoName}`
    }

    const { system, user } = buildGenerateRepoInfoPrompt(repoName, skeleton, readmeContent)

    const maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.llmClient.complete(user, system)
        const text = response.content

        // Extract from <solution> block with code fences
        const solutionMatch = text.match(/<solution>\s*```?\s*([\s\S]*?)\s*```?\s*<\/solution>/)
        if (solutionMatch)
          return solutionMatch[1]!.trim()

        // Try raw solution block without code fences
        const rawSolution = text.match(/<solution>\s*([\s\S]*?)\s*<\/solution>/)
        if (rawSolution)
          return rawSolution[1]!.trim()

        // Return raw text if no block found
        return text.trim()
      }
      catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        if (attempt < maxAttempts) {
          log.debug(`Repo info generation attempt ${attempt}/${maxAttempts} failed: ${msg}. Retrying...`)
          continue
        }
        log.warn(`Repo info generation failed after ${maxAttempts} attempts: ${msg}. Using fallback.`)
      }
    }

    return readmeContent.slice(0, 500) || `Repository: ${repoName}`
  }

  /**
   * Build a file-tree skeleton of the repository (up to maxLines lines, depth 3).
   */
  private async buildRepoSkeleton(maxLines = 200): Promise<string> {
    const lines: string[] = []
    const repoPath = this.repoPath

    async function walk(dir: string, prefix: string, depth: number): Promise<void> {
      if (depth > 3 || lines.length >= maxLines)
        return
      try {
        const entries = await readdir(dir)
        for (const entry of entries.sort()) {
          if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist')
            continue
          const fullPath = path.join(dir, entry)
          const s = await stat(fullPath)
          if (s.isDirectory()) {
            lines.push(`${prefix}${entry}/`)
            await walk(fullPath, `${prefix}  `, depth + 1)
          }
          else {
            lines.push(`${prefix}${entry}`)
          }
          if (lines.length >= maxLines)
            break
        }
      }
      catch (error) {
        log.debug(`buildRepoSkeleton: skipping unreadable entry in ${dir}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    await walk(repoPath, '', 0)
    return lines.join('\n')
  }

  /**
   * Use LLM multi-vote to exclude irrelevant files from analysis.
   * Files excluded by at least 2 out of 3 independent LLM votes are removed.
   */
  private async excludeIrrelevantFiles(
    files: string[],
    repoInfo: string | undefined,
  ): Promise<string[]> {
    if (!this.llmClient || files.length === 0)
      return files

    const repoName = (this.repoPath.split('/').pop() ?? 'unknown').toLowerCase()
    const skeleton = await this.buildRepoSkeleton()

    const fileList = files
      .map(f => path.relative(this.repoPath, f))
      .join('\n')

    const { system, user } = buildExcludeFilesPrompt(
      repoName,
      repoInfo ?? '',
      skeleton,
      fileList,
    )

    // Multi-vote: 3 independent LLM calls, keep files excluded by majority (>=2/3)
    const voteResults: Set<string>[] = []

    for (let vote = 0; vote < 3; vote++) {
      try {
        const response = await this.llmClient.complete(user, system)
        const excluded = this.parseExcludedPaths(response.content)
        voteResults.push(excluded)
      }
      catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        log.warn(`File exclusion vote ${vote + 1}/3 failed: ${msg}`)
        voteResults.push(new Set()) // Empty vote = keep all
      }
    }

    // Keep only files excluded by >=2/3 votes
    const toExclude = new Set<string>()
    const allExcluded = [
      ...new Set([...voteResults[0]!, ...voteResults[1]!, ...voteResults[2]!]),
    ]
    for (const excluded of allExcluded) {
      const voteCount = voteResults.filter(v => v.has(excluded)).length
      if (voteCount >= 2)
        toExclude.add(excluded)
    }

    if (toExclude.size > 0) {
      log.info(`LLM file exclusion: removing ${toExclude.size} files: ${[...toExclude].join(', ')}`)
    }

    return files.filter((f) => {
      const rel = path.relative(this.repoPath, f)
      return !this.isPathExcluded(rel, toExclude)
    })
  }

  private parseExcludedPaths(text: string): Set<string> {
    const excluded = new Set<string>()

    // Extract from <solution> block
    const solutionMatch = text.match(/<solution>\s*```?\s*([\s\S]*?)\s*```?\s*<\/solution>/)
    const content = solutionMatch ? solutionMatch[1] : text

    if (content) {
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
          excluded.add(trimmed)
        }
      }
    }

    return excluded
  }

  private isPathExcluded(relativePath: string, excluded: Set<string>): boolean {
    const normalized = relativePath.replaceAll('\\', '/')
    for (const excl of excluded) {
      const normalizedExcl = excl.replaceAll('\\', '/').replace(/\/$/, '')
      if (normalized === normalizedExcl)
        return true
      if (normalized.startsWith(`${normalizedExcl}/`))
        return true
    }
    return false
  }

  /**
   * Deduplicate file-level feature descriptions across extraction results.
   * If two files share the same description, append a numeric suffix to make them unique.
   */
  private deduplicateFileSummaries(
    extractionResults: Array<{ entities: ExtractedEntity[] }>,
  ): void {
    const usedDescriptions = new Set<string>()

    for (const result of extractionResults) {
      const fileEntity = result.entities.find(e => e.metadata.entityType === 'file')
      if (!fileEntity)
        continue

      const desc = fileEntity.feature.description
      if (!usedDescriptions.has(desc)) {
        usedDescriptions.add(desc)
      }
      else {
        // Append suffix to make unique
        let suffix = 1
        let candidate = `${desc}_${suffix}`
        while (usedDescriptions.has(candidate)) {
          suffix++
          candidate = `${desc}_${suffix}`
        }
        fileEntity.feature.description = candidate
        usedDescriptions.add(candidate)
      }
    }
  }

  /**
   * Analyze cross-area data flows using LLM and add DataFlowEdges between high-level nodes.
   */
  private async analyzeCrossAreaDataFlows(
    rpg: RepositoryPlanningGraph,
    repoInfo: string | undefined,
  ): Promise<void> {
    if (!this.llmClient)
      return

    // Get all high-level nodes (functional areas - L0 nodes with domain: prefix)
    const highLevelNodes = await rpg.getHighLevelNodes()
    const areaNodes = highLevelNodes.filter(n => n.id.startsWith('domain:') && !n.id.includes('/'))

    if (areaNodes.length < 2)
      return // Need at least 2 areas for cross-area flows

    const treesNames = areaNodes.map(n => n.id.replace('domain:', ''))

    // Build trees info (what each area contains)
    const treesInfo = areaNodes
      .map(n => `${n.id.replace('domain:', '')}: ${n.feature.description}`)
      .join('\n')

    // Get dependency edges to find cross-area invocations
    const depEdges = await rpg.getDependencyEdges()

    // Map edges to their functional areas (limit for prompt size)
    const crossAreaInvokes: string[] = []
    for (const edge of depEdges.slice(0, 100)) {
      crossAreaInvokes.push(`${edge.source} -> ${edge.target}`)
    }
    const summaryInvokes = crossAreaInvokes.join('\n') || 'No dependency edges found'

    const repoName = (this.repoPath.split('/').pop() ?? 'unknown').toLowerCase()
    const skeleton = treesNames.join('\n')

    const { system, user } = buildAnalyzeDataFlowPrompt(
      repoName,
      repoInfo ?? treesInfo,
      skeleton,
      treesNames,
      treesInfo,
      summaryInvokes,
      await this.getCrossBoundaryExcerpts(rpg, this.repoPath),
    )

    try {
      const response = await this.llmClient.complete(user, system, {
        maxTokens: 8192,
        providerOptions: {
          google: { thinkingConfig: { thinkingLevel: 'minimal' } },
        },
      })
      const edges = this.parseDataFlowEdges(response.content, treesNames)

      for (const edge of edges) {
        await rpg.addDataFlowEdge(edge)
      }

      log.info(`Cross-area data flow: added ${edges.length} semantic flow edges`)
    }
    catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.warn(`Cross-area data flow analysis failed: ${msg}`)
    }
  }

  /**
   * Build code excerpts for cross-area dependency edges.
   * For each dependency edge whose source and target belong to different domain areas,
   * reads the import/call line from the source file.
   */
  private async getCrossBoundaryExcerpts(
    rpg: RepositoryPlanningGraph,
    repoPath: string,
  ): Promise<string> {
    const lowLevelNodes = await rpg.getLowLevelNodes()
    const functionalEdges = await rpg.getFunctionalEdges()

    // Build a map from node id → domain area by walking up functional edges
    const parentMap = new Map<string, string>()
    for (const fe of functionalEdges) {
      parentMap.set(fe.target, fe.source)
    }

    const areaCache = new Map<string, string | undefined>()
    function findDomainArea(nodeId: string, visited = new Set<string>()): string | undefined {
      if (areaCache.has(nodeId))
        return areaCache.get(nodeId)
      if (visited.has(nodeId))
        return undefined
      visited.add(nodeId)
      let area: string | undefined
      if (nodeId.startsWith('domain:') && !nodeId.includes('/')) {
        area = nodeId.replace('domain:', '')
      }
      else {
        const parent = parentMap.get(nodeId)
        if (parent)
          area = findDomainArea(parent, visited)
      }
      areaCache.set(nodeId, area)
      return area
    }

    // Build node → area mapping for all low-level nodes
    const nodeAreaMap = new Map<string, string>()
    for (const node of lowLevelNodes) {
      const area = findDomainArea(node.id)
      if (area) {
        nodeAreaMap.set(node.id, area)
      }
    }

    // Get dependency edges and filter for cross-area
    const depEdges = await rpg.getDependencyEdges()
    const crossAreaEdges = depEdges.filter((e) => {
      const srcArea = nodeAreaMap.get(e.source)
      const tgtArea = nodeAreaMap.get(e.target)
      return srcArea && tgtArea && srcArea !== tgtArea
    })

    if (crossAreaEdges.length === 0) {
      return ''
    }

    // For each cross-area edge (up to MAX_CROSS_BOUNDARY_EXCERPTS), read the import/call line from source file
    const MAX_CROSS_BOUNDARY_EXCERPTS = 50 // cap to stay within LLM prompt budget
    const excerpts: string[] = []
    const nodeMap = new Map(lowLevelNodes.map(n => [n.id, n]))
    // Resolve repoPath once outside the loop (handles symlinks in repoPath itself)
    const resolvedRepo = await realpath(repoPath)

    for (const edge of crossAreaEdges.slice(0, MAX_CROSS_BOUNDARY_EXCERPTS)) {
      const sourceNode = nodeMap.get(edge.source)
      if (!sourceNode?.metadata?.path || edge.line == null)
        continue

      const filePath = path.join(repoPath, sourceNode.metadata.path)
      try {
        // Synchronous pre-check: catch '..' traversal and absolute paths without I/O.
        // Compare against path.resolve(repoPath) (not realpath) so the check works
        // correctly when repoPath itself is a symlink.
        const preResolved = path.resolve(repoPath, sourceNode.metadata.path)
        const repoBase = path.resolve(repoPath)
        if (!preResolved.startsWith(repoBase + path.sep) && preResolved !== repoBase) {
          log.warn(`getCrossBoundaryExcerpts: skipping out-of-bounds path: ${sourceNode.metadata.path}`)
          continue
        }
        // Resolve symlinks for the actual read; throws ENOENT if file missing (caught below)
        const resolvedFile = await realpath(filePath)
        if (!resolvedFile.startsWith(resolvedRepo + path.sep) && resolvedFile !== resolvedRepo) {
          log.warn(`getCrossBoundaryExcerpts: skipping symlink out-of-bounds: ${sourceNode.metadata.path}`)
          continue
        }
        const content = await readFile(resolvedFile, 'utf-8')
        const lines = content.split('\n')
        const lineIdx = edge.line - 1
        if (lineIdx >= 0 && lineIdx < lines.length) {
          const srcArea = nodeAreaMap.get(edge.source)
          const tgtArea = nodeAreaMap.get(edge.target)
          const MAX_EXCERPT_LINE_LENGTH = 300
          const rawLine = lines[lineIdx]!.trim()
          const truncatedLine = rawLine.length > MAX_EXCERPT_LINE_LENGTH
            ? `${rawLine.slice(0, MAX_EXCERPT_LINE_LENGTH)} ...[truncated]`
            : rawLine
          // Escape backticks to prevent prompt injection via malicious source content
          const excerptLine = truncatedLine.replace(/`/g, '\\`')
          excerpts.push(
            `[${srcArea} → ${tgtArea}] ${sourceNode.metadata.path}:${edge.line}: ${excerptLine}`,
          )
        }
      }
      catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        log.warn(`Cross-boundary excerpt read failed for ${sourceNode.metadata.path}:${edge.line}: ${msg}`)
      }
    }

    return excerpts.join('\n')
  }

  private parseDataFlowEdges(
    text: string,
    validTreeNames: string[],
  ): Array<{ source: string, target: string, dataId: string, dataType: string }> {
    // Extract from <solution> block
    const solutionMatch = text.match(/<solution>\s*([\s\S]*?)\s*<\/solution>/)
    const content = solutionMatch ? solutionMatch[1] : text

    // Try to parse JSON array
    const arrayMatch = content?.match(/\[[\s\S]*\]/)
    if (!arrayMatch)
      return []

    try {
      const parsed = JSON.parse(arrayMatch[0])
      if (!Array.isArray(parsed))
        return []

      const validNames = new Set(validTreeNames)
      return parsed
        .filter((e: unknown): e is { source: string, target: string, data_id?: string, dataId?: string, data_type?: string | string[], dataType?: string } =>
          typeof e === 'object'
          && e !== null
          && typeof (e as { source?: unknown }).source === 'string'
          && typeof (e as { target?: unknown }).target === 'string',
        )
        .filter(e => validNames.has(e.source) && validNames.has(e.target) && e.source !== e.target)
        .map(e => ({
          source: `domain:${e.source}`,
          target: `domain:${e.target}`,
          dataId: String(e.data_id ?? e.dataId ?? 'data'),
          dataType: Array.isArray(e.data_type)
            ? String(e.data_type[0] ?? 'unknown')
            : String(e.data_type ?? e.dataType ?? 'unknown'),
        }))
    }
    catch (error) {
      log.debug(`parseDataFlowEdges: failed to parse JSON array from LLM response: ${error instanceof Error ? error.message : String(error)}`)
      return []
    }
  }

  /**
   * Encode the repository into an RPG
   */
  async encode(): Promise<EncodingResult> {
    const startTime = Date.now()

    // Extract repository name from path
    const repoName = (this.repoPath.split('/').pop() ?? 'unknown').toLowerCase()

    const config: RPGConfig = {
      name: repoName,
      rootPath: this.repoPath,
    }

    const rpg = await RepositoryPlanningGraph.create(config)

    // Generate or use provided repo info (Area 2)
    const repoInfo = this.options.repoInfo
      ?? (this.options.generateRepoInfo !== false && this.llmClient
        ? await this.generateRepoInfo()
        : undefined)
    if (repoInfo) {
      log.info('Repo info: generated/provided')
    }

    // Build repo skeleton once and share with semantic extractor for richer prompts (Gap 1)
    if (this.llmClient) {
      const skeleton = await this.buildRepoSkeleton()
      this.semanticExtractor.setSkeleton(skeleton)
    }

    // Phase 1: Semantic Lifting (including file->child functional edges)
    const warnings: string[] = []
    let files: string[]
    try {
      files = await discoverFiles(this.repoPath, {
        include: this.options.include,
        exclude: this.options.exclude,
        maxDepth: this.options.maxDepth,
        respectGitignore: this.options.respectGitignore,
      })
    }
    catch (error) {
      const msg = `File discovery failed: ${error instanceof Error ? error.message : String(error)}`
      log.error(msg)
      warnings.push(msg)
      files = []
    }

    if (files.length === 0 && warnings.length > 0) {
      const emptyMsg = 'Proceeding with empty file list. The resulting graph will have no nodes.'
      log.warn(emptyMsg)
      warnings.push(emptyMsg)
    }

    // Optionally exclude irrelevant files using LLM (Area 3)
    if (this.options.excludeWithLLM && files.length > 0) {
      log.info('Excluding irrelevant files using LLM...')
      files = await this.excludeIrrelevantFiles(files, repoInfo)
      log.info(`After LLM exclusion: ${files.length} files remaining`)
    }

    let entitiesExtracted = 0
    const fileParseInfos: FileParseInfo[] = []

    // Buffer all extraction results for deduplication before adding to graph (Area 5)
    const allExtractionResults: ExtractionResult[] = []
    // When LLM is available, defer file summaries to batch processing (Gap 4)
    const deferFileSummary = !!this.llmClient

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!
      const displayPath = path.relative(this.repoPath, file)
      log.info(`[${i + 1}/${files.length}] ${displayPath}`)
      let extraction: ExtractionResult
      try {
        extraction = await this.extractEntities(file, deferFileSummary)
      }
      catch (error) {
        const msg = `Failed to extract ${displayPath}: ${error instanceof Error ? error.message : String(error)}`
        log.error(msg)
        warnings.push(msg)
        continue
      }

      entitiesExtracted += extraction.entities.length
      allExtractionResults.push(extraction)

      // Save cache incrementally after each file (survives interruption)
      await this.cache.save()
    }

    log.info(`Phase 1 done: ${this.cacheHits} cache hits, ${this.cacheMisses} cache misses`)

    // Batch file summary generation (Gap 4): replace per-file heuristic summaries with LLM batch
    if (deferFileSummary) {
      // Pre-filter once to avoid iterating the full list multiple times (perf improvement)
      const resultsWithPending = allExtractionResults.filter(r => r.pendingFileSummary !== undefined)

      if (resultsWithPending.length > 0) {
        const pendingSummaries = resultsWithPending.map(r => r.pendingFileSummary!)
        log.info(`Phase 1 batch: generating file summaries for ${pendingSummaries.length} files...`)
        try {
          const batchSummaries = await this.semanticExtractor.aggregateFileFeaturesInBatch(pendingSummaries)
          for (const result of resultsWithPending) {
            const pending = result.pendingFileSummary!
            const summary = batchSummaries.get(pending.filePath)
            if (summary) {
              const fileEntity = result.entities.find(e => e.id === pending.fileEntityId)
              if (fileEntity) {
                fileEntity.feature = summary
              }
            }
          }
        }
        catch (error) {
          const msg = `Batch file summary generation failed: ${error instanceof Error ? error.message : String(error)}`
          log.warn(`${msg}. File summaries will use heuristic.`)
          warnings.push(msg)
        }
      }
    }

    // Collect any LLM fallback warnings from the semantic extractor (e.g. batch failures)
    warnings.push(...this.semanticExtractor.getWarnings())

    // Deduplicate file-level summaries before adding to graph (Area 5)
    this.deduplicateFileSummaries(allExtractionResults)

    // Add all entities to graph after deduplication
    for (const extraction of allExtractionResults) {
      const { entities, fileToChildEdges, parseResult, sourceCode, relativePath } = extraction

      // Add nodes
      for (const entity of entities) {
        await rpg.addLowLevelNode({
          id: entity.id,
          feature: entity.feature,
          metadata: entity.metadata,
          sourceCode: this.options.includeSource ? entity.sourceCode : undefined,
        })
      }

      // Add file->child functional edges (Phase 1, per paper section 3.1)
      for (const edge of fileToChildEdges) {
        await rpg.addFunctionalEdge(edge)
      }

      // Collect parse info for data flow detection
      const fileEntity = entities.find(e => e.metadata.entityType === 'file')
      if (fileEntity && parseResult) {
        fileParseInfos.push({
          filePath: relativePath,
          nodeId: fileEntity.id,
          parseResult,
          sourceCode,
        })
      }
    }

    // Phase 2: Structural Reorganization
    log.info('Phase 2: Structural Reorganization...')
    await this.buildFunctionalHierarchy(rpg, repoInfo, warnings)

    // Phase 3: Artifact Grounding
    log.info('Phase 3.1: Metadata propagation...')
    try {
      const grounder = new ArtifactGrounder(rpg)
      await grounder.ground()
    }
    catch (error) {
      const msg = 'Artifact grounding failed, continuing without path metadata: '
        + `${error instanceof Error ? error.message : String(error)}`
      log.warn(msg)
      warnings.push(msg)
    }

    // Phase 3b: Artifact Grounding - dependency injection
    if (this.astParser.isAvailable()) {
      log.info('Phase 3.2: Dependency injection...')
      try {
        await injectDependencies(rpg, this.repoPath, this.astParser)
      }
      catch (error) {
        const msg = 'Dependency injection failed, continuing without dependency edges: '
          + `${error instanceof Error ? error.message : String(error)}`
        log.warn(msg)
        warnings.push(msg)
      }
    }
    else {
      log.info('Phase 3.2: Dependency injection skipped (tree-sitter not available)')
    }

    // Phase 3c: Data flow edge creation (section 3.2 inter-module + intra-module flows)
    log.info('Phase 3.3: Data flow detection...')
    try {
      await this.injectDataFlows(rpg, fileParseInfos)
    }
    catch (error) {
      const msg = 'Data flow detection failed, continuing without data flow edges: '
        + `${error instanceof Error ? error.message : String(error)}`
      log.warn(msg)
      warnings.push(msg)
    }

    // Phase 3d: Cross-area data flow analysis (Area 8)
    if (this.llmClient) {
      log.info('Phase 3.4: Cross-area data flow analysis...')
      try {
        await this.analyzeCrossAreaDataFlows(rpg, repoInfo)
      }
      catch (error) {
        const msg = `Cross-area data flow analysis failed: ${error instanceof Error ? error.message : String(error)}`
        log.warn(msg)
        warnings.push(msg)
      }
    }

    // Log LLM token usage statistics
    const allStats = [
      this.semanticExtractor.getLLMClient()?.getUsageStats(),
      this.llmClient?.getUsageStats(),
    ].filter((s): s is TokenUsageStats => s != null && s.requestCount > 0)

    const totalRequests = allStats.reduce((sum, s) => sum + s.requestCount, 0)
    if (totalRequests > 0) {
      const totalInput = allStats.reduce((sum, s) => sum + s.totalPromptTokens, 0)
      const totalOutput = allStats.reduce((sum, s) => sum + s.totalCompletionTokens, 0)
      const totalTokens = totalInput + totalOutput

      const costClient = this.semanticExtractor.getLLMClient() ?? this.llmClient
      const combinedStats = { totalPromptTokens: totalInput, totalCompletionTokens: totalOutput, totalTokens, requestCount: totalRequests }
      const cost = costClient?.estimateCost(combinedStats)
      const costStr = cost && cost.totalCost > 0 ? ` (~$${cost.totalCost.toFixed(4)})` : ''

      log.info(`LLM usage: ${totalRequests} requests, ${totalInput.toLocaleString()} input + ${totalOutput.toLocaleString()} output = ${totalTokens.toLocaleString()} total tokens${costStr}`)
    }

    this._rpg = rpg

    return {
      rpg,
      filesProcessed: files.length,
      entitiesExtracted,
      duration: Date.now() - startTime,
      ...(warnings.length > 0 && { warnings }),
    }
  }

  /**
   * Extract entities (functions, classes) from a file.
   *
   * When deferFileSummary is true (Gap 4), uses a heuristic placeholder for the file-level
   * summary and returns a pendingFileSummary entry so the caller can batch-aggregate
   * summaries for all files in a single LLM call after the main loop.
   */
  private async extractEntities(file: string, deferFileSummary = false): Promise<ExtractionResult> {
    const extraction = await extractEntitiesFromFile(file, this.repoPath, this.astParser)
    const entities: ExtractedEntity[] = []

    // Step 1: Extract child entities first (functions, classes, methods)
    const childEntities: ExtractedEntity[] = []
    // Track entity names alongside extracted entities for enriched file summary prompts (Gap 4-A)
    const childEntityNames = new Map<ExtractedEntity, string>()
    for (const extracted of extraction.entities) {
      const extractedEntity = await this.convertCodeEntity(
        extracted.codeEntity,
        extraction.relativePath,
        extracted.id,
        extraction.sourceCode,
      )
      if (extractedEntity) {
        childEntities.push(extractedEntity)
        childEntityNames.set(extractedEntity, extracted.codeEntity.name)
      }
    }

    // Step 2: Collect direct children's features for file-level aggregation
    // Only include top-level entities (functions/classes, not methods nested inside classes)
    const directChildFeatures: SemanticFeature[] = childEntities
      .filter(e => e.metadata.entityType !== 'method')
      .map(e => e.feature)

    // Build enriched entity list with names and types for Gap 4-A
    const directChildEntities = childEntities
      .filter(e => e.metadata.entityType !== 'method')
      .map(e => ({
        name: childEntityNames.get(e) ?? '(unknown)',
        type: e.metadata.entityType,
        feature: e.feature,
      }))

    // Step 3: Aggregate into file-level feature
    const fileId = extraction.fileEntityId
    const fileName = path.basename(extraction.relativePath, path.extname(extraction.relativePath))

    let fileFeature: SemanticFeature
    let pendingFileSummary: ExtractionResult['pendingFileSummary']

    if (deferFileSummary && directChildFeatures.length > 0) {
      // Use heuristic as placeholder; the caller will replace with LLM batch result (Gap 4)
      fileFeature = await this.semanticExtractor.aggregateFileFeatures(
        directChildFeatures,
        fileName,
        extraction.relativePath,
        /* skipLLM */ true,
      )
      pendingFileSummary = {
        fileEntityId: fileId,
        fileName,
        filePath: extraction.relativePath,
        childFeatures: directChildFeatures,
        childEntities: directChildEntities,
      }
    }
    else if (directChildFeatures.length > 0) {
      fileFeature = await this.semanticExtractor.aggregateFileFeatures(
        directChildFeatures,
        fileName,
        extraction.relativePath,
      )
    }
    else {
      fileFeature = await this.extractSemanticFeature({
        type: 'file',
        name: fileName,
        filePath: extraction.relativePath,
      })
    }

    entities.push({
      id: fileId,
      feature: fileFeature,
      metadata: {
        entityType: 'file',
        path: extraction.relativePath,
      },
    })

    // Step 4: Add child entities
    entities.push(...childEntities)

    // Step 5: Generate file->child edges for Phase 1
    const fileToChildEdges = childEntities.map(child => ({
      source: fileId,
      target: child.id,
    }))

    return {
      entities,
      fileToChildEdges,
      parseResult: extraction.parseResult,
      sourceCode: extraction.sourceCode,
      relativePath: extraction.relativePath,
      pendingFileSummary,
    }
  }

  /**
   * Convert CodeEntity to ExtractedEntity
   */
  private async convertCodeEntity(
    entity: CodeEntity,
    filePath: string,
    entityId: string,
    fileSourceCode?: string,
  ): Promise<ExtractedEntity | null> {
    const entityType = mapEntityType(entity.type)
    if (!entityType)
      return null

    // Extract entity source code from file
    let entitySourceCode: string | undefined
    if (fileSourceCode && entity.startLine !== undefined && entity.endLine !== undefined) {
      const lines = fileSourceCode.split('\n')
      entitySourceCode = lines.slice(entity.startLine - 1, entity.endLine).join('\n')
    }

    // Use semantic extractor with caching
    const feature = await this.extractSemanticFeature({
      type: entity.type,
      name: entity.name,
      filePath,
      parent: entity.parent,
      sourceCode: entitySourceCode,
    })

    return {
      id: entityId,
      feature,
      metadata: {
        entityType,
        path: filePath,
        startLine: entity.startLine,
        endLine: entity.endLine,
      },
      sourceCode: entitySourceCode,
    }
  }

  /**
   * Extract semantic feature with caching
   */
  private async extractSemanticFeature(input: EntityInput): Promise<SemanticFeature> {
    // Check cache first
    const cached = await this.cache.get(input)
    if (cached) {
      this.cacheHits++
      return cached
    }

    this.cacheMisses++

    // Extract using semantic extractor
    const feature = await this.semanticExtractor.extract(input)

    // Cache the result
    await this.cache.set(input, feature)

    return feature
  }

  /**
   * Build functional hierarchy using LLM-based semantic reorganization.
   *
   * Implements paper section 3.2: Domain Discovery + Hierarchical Construction.
   * Replaces the old directory-mirroring approach with semantic 3-level paths.
   */
  private async buildFunctionalHierarchy(
    rpg: RepositoryPlanningGraph,
    repoInfo?: string,
    warnings: string[] = [],
  ): Promise<void> {
    const lowLevelNodes = await rpg.getLowLevelNodes()
    const fileGroups = this.buildFileFeatureGroups(lowLevelNodes)

    // Nothing to reorganize if no file nodes exist
    if (fileGroups.length === 0)
      return

    if (!this.llmClient) {
      // If user explicitly requested LLM, throw. Otherwise skip silently.
      if (this.options.semantic?.useLLM === true || this.options.semantic?.provider) {
        throw new Error(
          'Semantic reorganization requires an LLM provider. '
          + 'Set GOOGLE_GENERATIVE_AI_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY.',
        )
      }
      return
    }

    // Step 1: Domain Discovery - identify functional areas
    log.info(`Phase 2.1: Domain Discovery (${fileGroups.length} file groups)...`)
    const domainDiscovery = new DomainDiscovery(this.llmClient)
    let functionalAreas: string[]
    try {
      const result = await domainDiscovery.discover(fileGroups, {
        repoInfo,
        callOptions: {
          maxTokens: 4096,
          providerOptions: {
            google: { thinkingConfig: { thinkingLevel: 'minimal' } },
          },
        },
      })
      functionalAreas = result.functionalAreas
    }
    catch (error) {
      const msg = `Phase 2.1 (Domain Discovery) failed: ${error instanceof Error ? error.message : String(error)}`
      log.error(msg)
      warnings.push(msg)
      return
    }
    log.info(`Phase 2.1: Found ${functionalAreas.length} functional areas: ${functionalAreas.join(', ')}`)

    // Step 2: Hierarchical Construction - build 3-level paths and link nodes
    log.info('Phase 2.2: Hierarchical Construction...')
    const hierarchyBuilder = new HierarchyBuilder(rpg, this.llmClient)
    try {
      await hierarchyBuilder.build(functionalAreas, fileGroups, {
        repoInfo,
        callOptions: {
          maxTokens: 32768,
          providerOptions: {
            google: { thinkingConfig: { thinkingLevel: 'minimal' } },
          },
          timeout: 300_000,
        },
      })
    }
    catch (error) {
      const msg = `Phase 2.2 (Hierarchical Construction) failed: ${error instanceof Error ? error.message : String(error)}`
      log.error(msg)
      warnings.push(msg)
      return
    }
    log.info('Phase 2.2: Done')
  }

  /**
   * Build file feature groups from low-level nodes.
   *
   * Groups file-level LowLevelNodes by top-level directory, extracting only
   * file-level features. This is the paper's "granularity-based input compression".
   */
  private buildFileFeatureGroups(lowLevelNodes: LowLevelNode[]): FileFeatureGroup[] {
    const fileNodes = lowLevelNodes.filter(n => n.metadata?.entityType === 'file')

    // Group by top-level directory
    const groups = new Map<string, FileFeatureGroup>()

    for (const node of fileNodes) {
      const filePath = node.metadata?.path
      if (!filePath)
        continue

      // Extract top-level directory as group label
      const segments = filePath.split('/')
      const groupLabel = segments.length > 1 ? segments[0]! : '.'

      let group = groups.get(groupLabel)
      if (!group) {
        group = { groupLabel, fileFeatures: [] }
        groups.set(groupLabel, group)
      }

      group.fileFeatures.push({
        fileId: node.id,
        filePath,
        description: node.feature.description,
        keywords: node.feature.keywords ?? [],
      })
    }

    return [...groups.values()]
  }

  /**
   * Inject data flow edges using the DataFlowDetector
   */
  private async injectDataFlows(
    rpg: RepositoryPlanningGraph,
    fileParseInfos: FileParseInfo[],
  ): Promise<void> {
    if (fileParseInfos.length === 0)
      return

    const detector = new DataFlowDetector({ repoPath: this.repoPath })
    const dataFlowEdges = detector.detectAll(fileParseInfos)

    // Deduplicate truly identical flows (same source, target, dataId) from the detector output.
    // Distinct flows between the same pair with different dataId values are now preserved,
    // since the store's UNIQUE constraint is (source, target, type, data_id).
    const seenFlows = new Set<string>()
    let dedupedCount = 0
    for (const edge of dataFlowEdges) {
      const flowKey = `${edge.source}|${edge.target}|${edge.dataId}`
      if (seenFlows.has(flowKey)) {
        dedupedCount++
        continue
      }
      seenFlows.add(flowKey)
      await rpg.addDataFlowEdge(edge)
    }
    if (dedupedCount > 0) {
      log.debug(`injectDataFlows: deduplicated ${dedupedCount} duplicate (source, target, dataId) data flow edge(s)`)
    }
  }

  /**
   * Incrementally update RPG with commit-level changes.
   *
   * Supports two calling patterns:
   *   encoder.evolve({ commitRange })           — uses this._rpg (from encode() or fromSaved())
   *   encoder.evolve(rpg, { commitRange })      — backward-compatible, passes RPG explicitly
   */
  async evolve(
    rpgOrOptions: RepositoryPlanningGraph | { commitRange: string },
    maybeOptions?: { commitRange: string },
  ): Promise<EvolutionResult> {
    let rpg: RepositoryPlanningGraph
    let options: { commitRange: string }

    if ('commitRange' in rpgOrOptions) {
      if (!this._rpg) {
        throw new Error('No RPG loaded. Call encode() or use fromSaved() first.')
      }
      rpg = this._rpg
      options = rpgOrOptions
    }
    else {
      rpg = rpgOrOptions as RepositoryPlanningGraph
      if (!maybeOptions) {
        throw new Error('evolve(rpg, options) requires options with commitRange. Use evolve({ commitRange }) with fromSaved() instead.')
      }
      options = maybeOptions
      this._rpg = rpg
    }

    const evolver = new RPGEvolver(rpg, {
      commitRange: options.commitRange,
      repoPath: this.repoPath,
      useLLM: this.options.semantic?.useLLM,
      semantic: this.options.semantic,
      includeSource: this.options.includeSource,
    })
    return evolver.evolve()
  }
}
