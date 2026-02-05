import type { RPGConfig } from '../graph'
import type { CodeEntity } from '../utils/ast'
import type { CacheOptions } from './cache'
import type { EntityInput, SemanticOptions } from './semantic'
import fs from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { RepositoryPlanningGraph } from '../graph'
import { ASTParser } from '../utils/ast'
import { SemanticCache } from './cache'
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
  feature: { description: string, keywords?: string[] }
  metadata: {
    entityType: 'file' | 'class' | 'function' | 'method'
    path: string
    startLine?: number
    endLine?: number
  }
  sourceCode?: string
}

export class RPGEncoder {
  private repoPath: string
  private options: EncoderOptions
  private astParser: ASTParser
  private semanticExtractor: SemanticExtractor
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

    // Phase 1: Semantic Lifting
    const files = await this.discoverFiles()
    let entitiesExtracted = 0

    for (const file of files) {
      const entities = await this.extractEntities(file)
      entitiesExtracted += entities.length

      for (const entity of entities) {
        await rpg.addLowLevelNode({
          id: entity.id,
          feature: entity.feature,
          metadata: entity.metadata,
          sourceCode: this.options.includeSource ? entity.sourceCode : undefined,
        })
      }
    }

    // Save cache after processing all files
    await this.cache.save()

    // Phase 2: Structural Reorganization
    await this.buildFunctionalHierarchy(rpg)

    // Phase 3: Artifact Grounding
    await this.injectDependencies(rpg)

    return {
      rpg,
      filesProcessed: files.length,
      entitiesExtracted,
      duration: Date.now() - startTime,
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
  private async extractEntities(file: string): Promise<ExtractedEntity[]> {
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

    // Add file-level entity with semantic extraction
    const fileId = this.generateEntityId(relativePath, 'file')
    const fileFeature = await this.extractSemanticFeature({
      type: 'file',
      name: path.basename(relativePath, path.extname(relativePath)),
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

    // Add code entities (functions, classes, methods)
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
        entities.push(extractedEntity)
      }
    }

    return entities
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
  private async extractSemanticFeature(
    input: EntityInput,
  ): Promise<{ description: string, keywords?: string[] }> {
    // Check cache first
    const cached = await this.cache.get(input)
    if (cached) {
      return {
        description: cached.description,
        keywords: cached.keywords,
      }
    }

    // Extract using semantic extractor
    const feature = await this.semanticExtractor.extract(input)

    // Cache the result
    await this.cache.set(input, feature)

    return {
      description: feature.description,
      keywords: feature.keywords,
    }
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
   * Build functional hierarchy from extracted entities
   *
   * Groups low-level nodes into high-level directory nodes and creates
   * functional edges representing the parent-child hierarchy.
   */
  private async buildFunctionalHierarchy(rpg: RepositoryPlanningGraph): Promise<void> {
    const lowLevelNodes = await rpg.getLowLevelNodes()
    const directoryGroups = this.groupNodesByDirectory(lowLevelNodes)

    // Create high-level directory nodes
    const directoryNodeIds = await this.createDirectoryNodes(rpg, directoryGroups)

    // Create edges: directory hierarchy, directory-to-file, file-to-entity
    await this.createDirectoryHierarchyEdges(rpg, directoryNodeIds)
    await this.createDirectoryToFileEdges(rpg, directoryGroups, directoryNodeIds)
    await this.createFileToEntityEdges(rpg, lowLevelNodes)
  }

  /**
   * Create high-level nodes for each directory
   */
  private async createDirectoryNodes(
    rpg: RepositoryPlanningGraph,
    directoryGroups: Map<string, Array<{ id: string, metadata?: { path?: string } }>>,
  ): Promise<Map<string, string>> {
    const directoryNodeIds = new Map<string, string>()

    for (const dirPath of directoryGroups.keys()) {
      if (dirPath === '.' || dirPath === '')
        continue

      const dirId = `dir:${dirPath}`
      const feature = await this.extractSemanticFeature({
        type: 'module',
        name: path.basename(dirPath),
        filePath: dirPath,
      })

      await rpg.addHighLevelNode({
        id: dirId,
        feature,
        directoryPath: dirPath,
        metadata: { entityType: 'module', path: dirPath },
      })

      directoryNodeIds.set(dirPath, dirId)
    }

    return directoryNodeIds
  }

  /**
   * Create parent-child edges for directory hierarchy
   */
  private async createDirectoryHierarchyEdges(
    rpg: RepositoryPlanningGraph,
    directoryNodeIds: Map<string, string>,
  ): Promise<void> {
    const sortedDirs = [...directoryNodeIds.keys()].sort(
      (a, b) => a.split('/').length - b.split('/').length,
    )

    for (const dirPath of sortedDirs) {
      const parentDir = path.dirname(dirPath)
      const sourceId = directoryNodeIds.get(parentDir)
      const targetId = directoryNodeIds.get(dirPath)

      if (sourceId && targetId) {
        await rpg.addFunctionalEdge({ source: sourceId, target: targetId })
      }
    }
  }

  /**
   * Connect file nodes to their directory nodes
   */
  private async createDirectoryToFileEdges(
    rpg: RepositoryPlanningGraph,
    directoryGroups: Map<string, Array<{ id: string, metadata?: { entityType?: string } }>>,
    directoryNodeIds: Map<string, string>,
  ): Promise<void> {
    for (const [dirPath, nodes] of directoryGroups.entries()) {
      const dirId = directoryNodeIds.get(dirPath)
      if (!dirId)
        continue

      for (const node of nodes) {
        if (node.metadata?.entityType === 'file') {
          await rpg.addFunctionalEdge({ source: dirId, target: node.id })
        }
      }
    }
  }

  /**
   * Connect non-file entities to their parent file nodes
   */
  private async createFileToEntityEdges(
    rpg: RepositoryPlanningGraph,
    lowLevelNodes: Array<{ id: string, metadata?: { entityType?: string, path?: string } }>,
  ): Promise<void> {
    for (const node of lowLevelNodes) {
      if (node.metadata?.entityType !== 'file' && node.metadata?.path) {
        const fileId = `${node.metadata.path}:file`
        if (await rpg.getNode(fileId)) {
          await rpg.addFunctionalEdge({ source: fileId, target: node.id })
        }
      }
    }
  }

  /**
   * Group low-level nodes by their directory path
   */
  private groupNodesByDirectory(
    nodes: Array<{ id: string, metadata?: { path?: string, entityType?: string } }>,
  ): Map<string, typeof nodes> {
    const groups = new Map<string, typeof nodes>()

    for (const node of nodes) {
      const nodePath = node.metadata?.path
      if (!nodePath)
        continue

      const dirPath = path.dirname(nodePath)

      const group = groups.get(dirPath)
      if (group) {
        group.push(node)
      }
      else {
        groups.set(dirPath, [node])
      }
    }

    return groups
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
   * Incrementally update RPG with new commits
   */
  async evolve(options: { commitRange: string }): Promise<void> {
    // TODO: Implement incremental updates
    console.log(`Evolving with commits: ${options.commitRange}`)
  }
}
