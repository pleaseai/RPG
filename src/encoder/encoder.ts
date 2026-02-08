import type { RPGConfig } from '../graph'
import type { LowLevelNode } from '../graph/node'
import type { CodeEntity } from '../utils/ast'
import type { CacheOptions } from './cache'
import type { FileParseInfo } from './data-flow'
import type { EvolutionResult } from './evolution/types'
import type { FileFeatureGroup } from './reorganization'
import type { EntityInput, SemanticFeature, SemanticOptions } from './semantic'
import fs from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { RepositoryPlanningGraph } from '../graph'
import { ASTParser } from '../utils/ast'
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
  parseResult: import('../utils/ast').ParseResult
  sourceCode?: string
}

export class RPGEncoder {
  private repoPath: string
  private options: EncoderOptions
  private astParser: ASTParser
  private semanticExtractor: SemanticExtractor
  private llmClient: LLMClient | null = null
  private cache: SemanticCache

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
    const repoName = this.repoPath.split('/').pop() ?? 'unknown'

    const config: RPGConfig = {
      name: repoName,
      rootPath: this.repoPath,
    }

    const rpg = await RepositoryPlanningGraph.create(config)

    // Phase 1: Semantic Lifting (including file→child functional edges)
    const files = await this.discoverFiles()
    let entitiesExtracted = 0
    const fileParseInfos: FileParseInfo[] = []

    for (const file of files) {
      const { entities, fileToChildEdges, parseResult, sourceCode } = await this.extractEntities(file)
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
    }

    // Save cache after processing all files
    await this.cache.save()

    // Phase 2: Structural Reorganization
    await this.buildFunctionalHierarchy(rpg)

    // Phase 3a: Artifact Grounding — metadata propagation
    const warnings: string[] = []
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
    await this.injectDependencies(rpg)

    // Phase 3c: Data flow edge creation (§3.2 inter-module + intra-module flows)
    try {
      await this.injectDataFlows(rpg, fileParseInfos)
    }
    catch (error) {
      const msg = `Data flow detection failed, continuing without data flow edges: `
        + `${error instanceof Error ? error.message : String(error)}`
      console.warn(`[RPGEncoder] ${msg}`)
      warnings.push(msg)
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
   * Discover files to process
   */
  private async discoverFiles(): Promise<string[]> {
    // Check if repository exists
    if (!fs.existsSync(this.repoPath)) {
      return []
    }

    const files: string[] = []
    const includePatterns = this.options.include ?? ['**/*.ts', '**/*.js', '**/*.py']
    const excludePatterns = this.options.exclude ?? [
      '**/node_modules/**',
      '**/dist/**',
      '**/.git/**',
    ]

    // Recursively walk directory
    await this.walkDirectory(this.repoPath, files, includePatterns, excludePatterns, 0)

    return files.sort()
  }

  /**
   * Recursively walk directory and collect matching files
   */
  private async walkDirectory(
    dir: string,
    files: string[],
    includePatterns: string[],
    excludePatterns: string[],
    depth: number,
  ): Promise<void> {
    const maxDepth = this.options.maxDepth ?? 10
    if (depth > maxDepth)
      return

    let entries: string[]
    try {
      entries = await readdir(dir)
    }
    catch {
      return
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry)
      const relativePath = path.relative(this.repoPath, fullPath)

      // Check if excluded
      if (this.matchesPattern(relativePath, excludePatterns)) {
        continue
      }

      let stats: fs.Stats
      try {
        stats = await stat(fullPath)
      }
      catch {
        continue
      }

      if (stats.isDirectory()) {
        await this.walkDirectory(fullPath, files, includePatterns, excludePatterns, depth + 1)
      }
      else if (stats.isFile()) {
        if (this.matchesPattern(relativePath, includePatterns)) {
          files.push(fullPath)
        }
      }
    }
  }

  /**
   * Check if path matches any of the glob patterns
   */
  private matchesPattern(filePath: string, patterns: string[]): boolean {
    return patterns.some(pattern => this.globMatch(filePath, pattern))
  }

  /**
   * Simple glob matching (supports * and **)
   */
  private globMatch(filePath: string, pattern: string): boolean {
    // Normalize path separators
    const normalizedPath = filePath.replace(/\\/g, '/')
    const normalizedPattern = pattern.replace(/\\/g, '/')

    // Split into segments for better matching
    const pathSegments = normalizedPath.split('/')
    const patternSegments = normalizedPattern.split('/')

    return this.matchSegments(pathSegments, patternSegments, 0, 0)
  }

  /**
   * Match path segments against pattern segments
   */
  private matchSegments(
    pathSegs: string[],
    patternSegs: string[],
    pathIdx: number,
    patternIdx: number,
  ): boolean {
    // Both exhausted - match
    if (pathIdx === pathSegs.length && patternIdx === patternSegs.length) {
      return true
    }

    // Pattern exhausted but path remaining - no match
    if (patternIdx === patternSegs.length) {
      return false
    }

    const patternSeg = patternSegs[patternIdx]
    if (patternSeg === undefined)
      return false

    // Handle ** (globstar)
    if (patternSeg === '**') {
      // Try matching zero or more directories
      for (let i = pathIdx; i <= pathSegs.length; i++) {
        if (this.matchSegments(pathSegs, patternSegs, i, patternIdx + 1)) {
          return true
        }
      }
      return false
    }

    // Path exhausted but pattern remaining (and not **)
    if (pathIdx === pathSegs.length) {
      return false
    }

    // Match single segment - patternSeg guaranteed to be string after undefined check above
    const pathSeg = pathSegs[pathIdx]
    if (pathSeg && this.matchSegment(pathSeg, patternSeg)) {
      return this.matchSegments(pathSegs, patternSegs, pathIdx + 1, patternIdx + 1)
    }

    return false
  }

  /**
   * Match single path segment against pattern segment
   */
  private matchSegment(pathSeg: string, patternSeg: string): boolean {
    // Convert pattern to regex
    const regexPattern = patternSeg
      .replace(/\./g, '\\.') // Escape dots
      .replace(/\*/g, '.*') // * matches anything
      .replace(/\?/g, '.') // ? matches single char

    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(pathSeg)
  }

  /**
   * Extract entities (functions, classes) from a file
   */
  private async extractEntities(file: string): Promise<ExtractionResult> {
    const relativePath = path.relative(this.repoPath, file)
    const entities: ExtractedEntity[] = []

    // Read source code for semantic extraction
    let sourceCode: string | undefined
    try {
      sourceCode = await readFile(file, 'utf-8')
    }
    catch {
      // Ignore read errors
    }

    // Parse the file
    const parseResult = await this.astParser.parseFile(file)

    // Step 1: Extract child entities first (functions, classes, methods)
    const childEntities: ExtractedEntity[] = []
    for (const entity of parseResult.entities) {
      const entityId = this.generateEntityId(
        relativePath,
        entity.type,
        entity.name,
        entity.startLine,
      )
      const extractedEntity = await this.convertCodeEntity(
        entity,
        relativePath,
        entityId,
        sourceCode,
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
    const fileId = this.generateEntityId(relativePath, 'file')
    const fileName = path.basename(relativePath, path.extname(relativePath))
    const fileFeature
      = directChildFeatures.length > 0
        ? await this.semanticExtractor.aggregateFileFeatures(
            directChildFeatures,
            fileName,
            relativePath,
          )
        : await this.extractSemanticFeature({
            type: 'file',
            name: fileName,
            filePath: relativePath,
          })

    entities.push({
      id: fileId,
      feature: fileFeature,
      metadata: {
        entityType: 'file',
        path: relativePath,
      },
    })

    // Step 4: Add child entities
    entities.push(...childEntities)

    // Step 5: Generate file→child edges for Phase 1
    const fileToChildEdges = childEntities.map(child => ({
      source: fileId,
      target: child.id,
    }))

    return { entities, fileToChildEdges, parseResult, sourceCode }
  }

  /**
   * Generate unique entity ID
   */
  private generateEntityId(
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
   * Convert CodeEntity to ExtractedEntity
   */
  private async convertCodeEntity(
    entity: CodeEntity,
    filePath: string,
    entityId: string,
    fileSourceCode?: string,
  ): Promise<ExtractedEntity | null> {
    const entityType = this.mapEntityType(entity.type)
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
      return cached
    }

    // Extract using semantic extractor
    const feature = await this.semanticExtractor.extract(input)

    // Cache the result
    await this.cache.set(input, feature)

    return feature
  }

  /**
   * Map AST entity type to RPG entity type
   */
  private mapEntityType(
    type: CodeEntity['type'],
  ): ExtractedEntity['metadata']['entityType'] | null {
    const typeMap: Record<string, ExtractedEntity['metadata']['entityType']> = {
      function: 'function',
      class: 'class',
      method: 'method',
    }
    return typeMap[type] ?? null
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
    const domainDiscovery = new DomainDiscovery(this.llmClient)
    const { functionalAreas } = await domainDiscovery.discover(fileGroups)

    // Step 2: Hierarchical Construction — build 3-level paths and link nodes
    const hierarchyBuilder = new HierarchyBuilder(rpg, this.llmClient)
    await hierarchyBuilder.build(functionalAreas, fileGroups)
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
   * Inject dependency edges via AST analysis
   *
   * Parses each file to extract import statements and creates
   * dependency edges between importing and imported files.
   */
  private async injectDependencies(rpg: RepositoryPlanningGraph): Promise<void> {
    const lowLevelNodes = await rpg.getLowLevelNodes()
    const fileNodes = lowLevelNodes.filter(n => n.metadata?.entityType === 'file')

    // Build a map of file paths to node IDs for quick lookup
    const filePathToNodeId = this.buildFilePathMap(fileNodes)

    // Track created edges to avoid duplicates
    const createdEdges = new Set<string>()

    // Parse each file and extract dependencies
    for (const node of fileNodes) {
      await this.extractFileDependencies(rpg, node, filePathToNodeId, createdEdges)
    }
  }

  /**
   * Build a map of file paths to node IDs
   */
  private buildFilePathMap(
    fileNodes: Array<{ id: string, metadata?: { path?: string } }>,
  ): Map<string, string> {
    const map = new Map<string, string>()
    for (const node of fileNodes) {
      if (node.metadata?.path) {
        map.set(node.metadata.path, node.id)
      }
    }
    return map
  }

  /**
   * Extract and create dependency edges for a single file
   */
  private async extractFileDependencies(
    rpg: RepositoryPlanningGraph,
    node: { id: string, metadata?: { path?: string } },
    filePathToNodeId: Map<string, string>,
    createdEdges: Set<string>,
  ): Promise<void> {
    const filePath = node.metadata?.path
    if (!filePath)
      return

    const fullPath = path.join(this.repoPath, filePath)
    const parseResult = await this.astParser.parseFile(fullPath)

    for (const importInfo of parseResult.imports) {
      const targetPath = this.resolveImportPath(filePath, importInfo.module)
      if (!targetPath)
        continue

      const targetNodeId = filePathToNodeId.get(targetPath)
      if (!targetNodeId || targetNodeId === node.id)
        continue

      // Avoid duplicate edges
      const edgeKey = `${node.id}->${targetNodeId}`
      if (createdEdges.has(edgeKey))
        continue
      createdEdges.add(edgeKey)

      await rpg.addDependencyEdge({
        source: node.id,
        target: targetNodeId,
        dependencyType: 'import',
      })
    }
  }

  /**
   * Resolve import module path to actual file path
   */
  private resolveImportPath(sourceFile: string, modulePath: string): string | null {
    // Skip external modules (node_modules, built-ins)
    if (!modulePath.startsWith('.') && !modulePath.startsWith('/')) {
      return null
    }

    const sourceDir = path.dirname(sourceFile)
    const resolvedPath = path.normalize(path.join(sourceDir, modulePath))

    // Try different extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '']
    for (const ext of extensions) {
      const candidatePath = resolvedPath + ext
      // Check if this path exists in our file set by normalizing
      const normalizedPath = candidatePath.replace(/\\/g, '/')
      if (!normalizedPath.startsWith('/')) {
        return normalizedPath
      }
    }

    // Handle index files (e.g., './utils' -> './utils/index.ts')
    for (const ext of extensions) {
      const indexPath = path.join(resolvedPath, `index${ext}`)
      const normalizedPath = indexPath.replace(/\\/g, '/')
      if (!normalizedPath.startsWith('/')) {
        return normalizedPath
      }
    }

    return resolvedPath.replace(/\\/g, '/')
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
