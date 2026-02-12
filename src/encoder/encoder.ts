import type { RPGConfig } from '../graph'
import type { LowLevelNode } from '../graph/node'
import type { CodeEntity, ParseResult } from '../utils/ast'
import type { TokenUsageStats } from '../utils/llm'
import type { CacheOptions } from './cache'
import type { FileParseInfo } from './data-flow'
import type { EvolutionResult } from './evolution/types'
import type { FileFeatureGroup } from './reorganization'
import type { EntityInput, SemanticFeature, SemanticOptions } from './semantic'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { RepositoryPlanningGraph } from '../graph'
import { ASTParser } from '../utils/ast'
import { resolveGitBinary } from '../utils/git-path'
import { LLMClient } from '../utils/llm'
import { SemanticCache } from './cache'
import { DataFlowDetector } from './data-flow'
import { RPGEvolver } from './evolution/evolve'
import { ArtifactGrounder } from './grounding'
import { DomainDiscovery, HierarchyBuilder } from './reorganization'
import { SemanticExtractor } from './semantic'

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
  catch {
    console.warn(
      `[discoverFiles] git binary not found on PATH. `
      + `Cannot check .gitignore rules; falling back to directory walk.`,
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
      console.warn(
        `[discoverFiles] git ls-files failed`
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

  const includePatterns = opts?.include ?? ['**/*.ts', '**/*.js', '**/*.py']
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
        console.warn(
          `[discoverFiles] git ls-files found ${gitFiles.length} files, `
          + `but 0 matched the configured filters (include/exclude/maxDepth). `
          + `Please check your configuration.`,
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
    console.warn(`[discoverFiles] Skipping directory ${dir}: ${msg}`)
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
    console.warn(`[discoverFiles] Skipping ${fullPath}: ${msg}`)
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
    console.warn(`[extractEntitiesFromFile] Cannot read ${filePath}: ${msg}`)
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

/**
 * Resolve an import module path to an actual file path relative to repo root.
 */
export function resolveImportPath(
  sourceFile: string,
  modulePath: string,
  knownFiles?: Set<string>,
): string | null {
  if (!modulePath.startsWith('.') && !modulePath.startsWith('/')) {
    return null
  }

  const sourceDir = path.dirname(sourceFile)
  const resolvedPath = path.normalize(path.join(sourceDir, modulePath))

  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '']
  const candidates: string[] = []

  for (const ext of extensions) {
    candidates.push((resolvedPath + ext).replaceAll('\\', '/'))
  }

  for (const ext of extensions) {
    candidates.push(path.join(resolvedPath, `index${ext}`).replaceAll('\\', '/'))
  }

  if (knownFiles) {
    return candidates.find(c => knownFiles.has(c)) ?? null
  }

  // Fallback: return first non-absolute path candidate
  return candidates.find(c => !c.startsWith('/')) ?? resolvedPath.replaceAll('\\', '/')
}

/**
 * Inject dependency edges into an RPG via AST analysis of import statements.
 *
 * Shared between RPGEncoder and interactive encoder.
 */
export async function injectDependencies(
  rpg: RepositoryPlanningGraph,
  repoPath: string,
  astParser: ASTParser,
): Promise<void> {
  const lowLevelNodes = await rpg.getLowLevelNodes()
  const fileNodes = lowLevelNodes.filter(n => n.metadata?.entityType === 'file')

  const filePathToNodeId = new Map<string, string>()
  for (const node of fileNodes) {
    if (node.metadata?.path) {
      filePathToNodeId.set(node.metadata.path, node.id)
    }
  }

  const knownFiles = new Set(filePathToNodeId.keys())
  const createdEdges = new Set<string>()

  for (const node of fileNodes) {
    const filePath = node.metadata?.path
    if (!filePath)
      continue

    const fullPath = path.join(repoPath, filePath)
    const parseResult = await astParser.parseFile(fullPath)

    await addImportEdges(rpg, node.id, filePath, parseResult.imports, filePathToNodeId, knownFiles, createdEdges)
  }
}

async function addImportEdges(
  rpg: RepositoryPlanningGraph,
  sourceNodeId: string,
  sourceFilePath: string,
  imports: Array<{ module: string }>,
  filePathToNodeId: Map<string, string>,
  knownFiles: Set<string>,
  createdEdges: Set<string>,
): Promise<void> {
  for (const importInfo of imports) {
    const targetPath = resolveImportPath(sourceFilePath, importInfo.module, knownFiles)
    if (!targetPath)
      continue

    const targetNodeId = filePathToNodeId.get(targetPath)
    if (!targetNodeId || targetNodeId === sourceNodeId)
      continue

    const edgeKey = `${sourceNodeId}->${targetNodeId}`
    if (createdEdges.has(edgeKey))
      continue
    createdEdges.add(edgeKey)

    await rpg.addDependencyEdge({
      source: sourceNodeId,
      target: targetNodeId,
      dependencyType: 'import',
    })
  }
}

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
}

export class RPGEncoder {
  private repoPath: string
  private options: EncoderOptions
  private astParser: ASTParser
  private semanticExtractor: SemanticExtractor
  private llmClient: LLMClient | null = null
  private cache: SemanticCache
  private cacheHits = 0
  private cacheMisses = 0

  constructor(repoPath: string, options?: Partial<Omit<EncoderOptions, 'repoPath'>>) {
    this.repoPath = repoPath
    this.astParser = new ASTParser()
    this.options = {
      repoPath,
      includeSource: false,
      include: ['**/*.ts', '**/*.js', '**/*.py'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
      maxDepth: 10,
      ...options,
    }

    // Initialize semantic extractor and cache
    this.semanticExtractor = new SemanticExtractor(this.options.semantic)
    this.cache = new SemanticCache({
      cacheDir: path.join(this.repoPath, '.please', 'cache'),
      ...this.options.cache,
    })

    // Initialize shared LLM client for reorganization module
    this.llmClient = this.createLLMClient()

    // Log LLM configuration
    const provider = this.llmClient?.getProvider()
    const model = this.llmClient?.getModel()
    if (provider) {
      console.log(`[RPGEncoder] LLM: ${provider} (${model})`)
    }
    else {
      console.log(`[RPGEncoder] LLM: disabled (heuristic mode)`)
    }
  }

  private createLLMClient(): LLMClient | null {
    const semantic = this.options.semantic
    if (semantic?.useLLM === false)
      return null

    const provider
      = semantic?.provider
        ?? (process.env.GOOGLE_API_KEY
          ? 'google'
          : process.env.ANTHROPIC_API_KEY
            ? 'anthropic'
            : process.env.OPENAI_API_KEY
              ? 'openai'
              : null)

    if (!provider)
      return null

    return new LLMClient({
      provider,
      apiKey: semantic?.apiKey,
      maxTokens: semantic?.maxTokens,
    })
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

    // Phase 1: Semantic Lifting (including file→child functional edges)
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
      console.error(`[RPGEncoder] ${msg}`)
      warnings.push(msg)
      files = []
    }

    if (files.length === 0 && warnings.length > 0) {
      const emptyMsg = `Proceeding with empty file list. The resulting graph will have no nodes.`
      console.warn(`[RPGEncoder] ${emptyMsg}`)
      warnings.push(emptyMsg)
    }
    let entitiesExtracted = 0
    const fileParseInfos: FileParseInfo[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!
      const displayPath = path.relative(this.repoPath, file)
      console.log(`[RPGEncoder] [${i + 1}/${files.length}] ${displayPath}`)
      let extraction: Awaited<ReturnType<typeof this.extractEntities>>
      try {
        extraction = await this.extractEntities(file)
      }
      catch (error) {
        const msg = `Failed to extract ${displayPath}: ${error instanceof Error ? error.message : String(error)}`
        console.error(`[RPGEncoder] ${msg}`)
        warnings.push(msg)
        continue
      }
      const { entities, fileToChildEdges, parseResult, sourceCode } = extraction
      entitiesExtracted += entities.length

      // Add nodes
      for (const entity of entities) {
        await rpg.addLowLevelNode({
          id: entity.id,
          feature: entity.feature,
          metadata: entity.metadata,
          sourceCode: this.options.includeSource ? entity.sourceCode : undefined,
        })
      }

      // Add file→child functional edges (Phase 1, per paper §3.1)
      for (const edge of fileToChildEdges) {
        await rpg.addFunctionalEdge(edge)
      }

      // Collect parse info for data flow detection
      const relativePath = path.relative(this.repoPath, file)
      const fileEntity = entities.find(e => e.metadata.entityType === 'file')
      if (fileEntity && parseResult) {
        fileParseInfos.push({
          filePath: relativePath,
          nodeId: fileEntity.id,
          parseResult,
          sourceCode,
        })
      }

      // Save cache incrementally after each file (survives interruption)
      await this.cache.save()
    }

    console.log(`[RPGEncoder] Phase 1 done: ${this.cacheHits} cache hits, ${this.cacheMisses} cache misses`)

    // Phase 2: Structural Reorganization
    console.log(`[RPGEncoder] Phase 2: Structural Reorganization...`)
    await this.buildFunctionalHierarchy(rpg)

    // Phase 3: Artifact Grounding
    console.log(`[RPGEncoder] Phase 3.1: Metadata propagation...`)
    try {
      const grounder = new ArtifactGrounder(rpg)
      await grounder.ground()
    }
    catch (error) {
      const msg = `Artifact grounding failed, continuing without path metadata: `
        + `${error instanceof Error ? error.message : String(error)}`
      console.warn(`[RPGEncoder] ${msg}`)
      warnings.push(msg)
    }

    // Phase 3b: Artifact Grounding — dependency injection
    console.log(`[RPGEncoder] Phase 3.2: Dependency injection...`)
    await injectDependencies(rpg, this.repoPath, this.astParser)

    // Phase 3c: Data flow edge creation (§3.2 inter-module + intra-module flows)
    console.log(`[RPGEncoder] Phase 3.3: Data flow detection...`)
    try {
      await this.injectDataFlows(rpg, fileParseInfos)
    }
    catch (error) {
      const msg = `Data flow detection failed, continuing without data flow edges: `
        + `${error instanceof Error ? error.message : String(error)}`
      console.warn(`[RPGEncoder] ${msg}`)
      warnings.push(msg)
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

      console.log(`[RPGEncoder] LLM usage: ${totalRequests} requests, ${totalInput.toLocaleString()} input + ${totalOutput.toLocaleString()} output = ${totalTokens.toLocaleString()} total tokens${costStr}`)
    }

    return {
      rpg,
      filesProcessed: files.length,
      entitiesExtracted,
      duration: Date.now() - startTime,
      ...(warnings.length > 0 && { warnings }),
    }
  }

  /**
   * Extract entities (functions, classes) from a file
   */
  private async extractEntities(file: string): Promise<ExtractionResult> {
    const extraction = await extractEntitiesFromFile(file, this.repoPath, this.astParser)
    const entities: ExtractedEntity[] = []

    // Step 1: Extract child entities first (functions, classes, methods)
    const childEntities: ExtractedEntity[] = []
    for (const extracted of extraction.entities) {
      const extractedEntity = await this.convertCodeEntity(
        extracted.codeEntity,
        extraction.relativePath,
        extracted.id,
        extraction.sourceCode,
      )
      if (extractedEntity) {
        childEntities.push(extractedEntity)
      }
    }

    // Step 2: Collect direct children's features for file-level aggregation
    // Only include top-level entities (functions/classes, not methods nested inside classes)
    const directChildFeatures: SemanticFeature[] = childEntities
      .filter(e => e.metadata.entityType !== 'method')
      .map(e => e.feature)

    // Step 3: Aggregate into file-level feature
    const fileId = extraction.fileEntityId
    const fileName = path.basename(extraction.relativePath, path.extname(extraction.relativePath))
    const fileFeature
      = directChildFeatures.length > 0
        ? await this.semanticExtractor.aggregateFileFeatures(
            directChildFeatures,
            fileName,
            extraction.relativePath,
          )
        : await this.extractSemanticFeature({
            type: 'file',
            name: fileName,
            filePath: extraction.relativePath,
          })

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

    // Step 5: Generate file→child edges for Phase 1
    const fileToChildEdges = childEntities.map(child => ({
      source: fileId,
      target: child.id,
    }))

    return { entities, fileToChildEdges, parseResult: extraction.parseResult, sourceCode: extraction.sourceCode }
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
   * Implements paper §3.2: Domain Discovery + Hierarchical Construction.
   * Replaces the old directory-mirroring approach with semantic 3-level paths.
   */
  private async buildFunctionalHierarchy(rpg: RepositoryPlanningGraph): Promise<void> {
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
          + 'Set GOOGLE_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY.',
        )
      }
      return
    }

    // Step 1: Domain Discovery — identify functional areas
    console.log(`[RPGEncoder] Phase 2.1: Domain Discovery (${fileGroups.length} file groups)...`)
    const domainDiscovery = new DomainDiscovery(this.llmClient)
    let functionalAreas: string[]
    try {
      const result = await domainDiscovery.discover(fileGroups)
      functionalAreas = result.functionalAreas
    }
    catch (error) {
      console.error(`[RPGEncoder] Phase 2.1 failed: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    console.log(`[RPGEncoder] Phase 2.1: Found ${functionalAreas.length} functional areas: ${functionalAreas.join(', ')}`)

    // Step 2: Hierarchical Construction — build 3-level paths and link nodes
    console.log(`[RPGEncoder] Phase 2.2: Hierarchical Construction...`)
    const hierarchyBuilder = new HierarchyBuilder(rpg, this.llmClient)
    try {
      await hierarchyBuilder.build(functionalAreas, fileGroups)
    }
    catch (error) {
      console.error(`[RPGEncoder] Phase 2.2 failed: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    console.log(`[RPGEncoder] Phase 2.2: Done`)
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

    for (const edge of dataFlowEdges) {
      await rpg.addDataFlowEdge(edge)
    }
  }

  /**
   * Incrementally update RPG with commit-level changes.
   *
   * Delegates to RPGEvolver which implements the Evolution pipeline
   * from RPG-Encoder §3 (Appendix A.2): Delete → Modify → Insert scheduling.
   */
  async evolve(
    rpg: RepositoryPlanningGraph,
    options: { commitRange: string },
  ): Promise<EvolutionResult> {
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
