import type { EntityType } from '../../graph/node'
import type { CodeEntity } from '../../utils/ast'
import type { ChangedEntity, DiffResult, FileChange, FileChangeStatus } from './types'
import { execFileSync } from 'node:child_process'
import { ASTParser } from '../../utils/ast'

/**
 * Parse git diff between two commits and produce entity-level change sets.
 *
 * Pipeline:
 * 1. `git diff <commitRange> --name-status` → file-level changes (A/M/D)
 * 2. For each changed file, extract entities from old/new revisions via ASTParser
 * 3. Match entities by qualified name to categorize into (U+, U-, U~)
 */
export class DiffParser {
  private repoPath: string
  private astParser: ASTParser

  constructor(repoPath: string, astParser?: ASTParser) {
    this.repoPath = repoPath
    this.astParser = astParser ?? new ASTParser()
  }

  /**
   * Parse a commit range into entity-level changes
   */
  async parse(commitRange: string): Promise<DiffResult> {
    this.validateCommitRange(commitRange)

    const result: DiffResult = {
      insertions: [],
      deletions: [],
      modifications: [],
    }

    // Step 1: Get file-level changes
    let fileChanges: FileChange[]
    try {
      fileChanges = await this.getFileChanges(commitRange)
    }
    catch (error) {
      throw new Error(
        `Failed to parse git diff for range "${commitRange}" in ${this.repoPath}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    // Step 2: For each changed file, extract entity-level changes
    const [oldRev, newRev] = this.parseCommitRange(commitRange)

    for (const change of fileChanges) {
      // Skip binary/unsupported files
      if (!this.isSupported(change.filePath)) {
        continue
      }

      switch (change.status) {
        case 'D': {
          // Deleted file: all entities are deletions
          const oldEntities = await this.extractEntitiesFromRevision(oldRev, change.filePath)
          for (const entity of oldEntities) {
            result.deletions.push(entity)
          }
          break
        }
        case 'A': {
          // Added file: all entities are insertions
          const newEntities = await this.extractEntitiesFromRevision(newRev, change.filePath)
          for (const entity of newEntities) {
            result.insertions.push(entity)
          }
          break
        }
        case 'M': {
          // Modified file: diff old vs new entities by qualified name
          const [oldEntities, newEntities] = await Promise.all([
            this.extractEntitiesFromRevision(oldRev, change.filePath),
            this.extractEntitiesFromRevision(newRev, change.filePath),
          ])
          this.diffEntities(oldEntities, newEntities, result)
          break
        }
      }
    }

    return result
  }

  /**
   * Get file-level changes from git diff --name-status
   */
  async getFileChanges(commitRange: string): Promise<FileChange[]> {
    const output = await this.execGit([
      'diff',
      '--name-status',
      '--no-renames', // Treat renames as delete + add
      commitRange,
      '--', // Prevent commitRange from being interpreted as a flag
    ])

    return this.parseNameStatus(output)
  }

  /**
   * Parse git diff --name-status output
   */
  parseNameStatus(output: string): FileChange[] {
    const changes: FileChange[] = []

    for (const line of output.trim().split('\n')) {
      if (!line.trim())
        continue
      const parsed = this.parseNameStatusLine(line)
      if (parsed)
        changes.push(...parsed)
    }

    return changes
  }

  /**
   * Parse a single line of git diff --name-status output
   */
  private parseNameStatusLine(line: string): FileChange[] | null {
    const parts = line.split('\t')
    const statusChar = parts[0]?.trim()
    const filePath = parts[1]?.trim()

    if (!statusChar || !filePath)
      return null

    // Handle rename status (R100, R090, etc.) as delete + add
    if (statusChar.startsWith('R')) {
      const newPath = parts[2]?.trim()
      if (filePath && newPath) {
        return [
          { status: 'D', filePath },
          { status: 'A', filePath: newPath },
        ]
      }
      return null
    }

    // Handle copy status as add
    if (statusChar.startsWith('C')) {
      const newPath = parts[2]?.trim()
      if (newPath) {
        return [{ status: 'A', filePath: newPath }]
      }
      return null
    }

    const status = statusChar as FileChangeStatus
    if (status === 'A' || status === 'M' || status === 'D') {
      return [{ status, filePath }]
    }

    return null
  }

  /**
   * Extract entities from a file at a specific git revision
   */
  async extractEntitiesFromRevision(revision: string, filePath: string): Promise<ChangedEntity[]> {
    let source: string
    try {
      source = await this.execGit(['show', `${revision}:${filePath}`])
    }
    catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      // git show exits with 128 when path doesn't exist at revision
      if (
        msg.includes('does not exist')
        || msg.includes('exists on disk, but not in')
        || msg.includes('exit 128')
      ) {
        return []
      }
      throw error
    }

    const language = this.astParser.detectLanguage(filePath)
    if (language === 'unknown') {
      return []
    }

    const parseResult = await this.astParser.parse(source, language)

    return this.codeEntitiesToChangedEntities(parseResult.entities, filePath, source)
  }

  /**
   * Convert CodeEntity[] to ChangedEntity[] with stable IDs
   */
  private codeEntitiesToChangedEntities(
    entities: CodeEntity[],
    filePath: string,
    source: string,
  ): ChangedEntity[] {
    const result: ChangedEntity[] = []
    const lines = source.split('\n')

    // Add file-level entity
    result.push({
      id: `${filePath}:file:${filePath}`,
      filePath,
      entityType: 'file',
      entityName: filePath,
      qualifiedName: filePath,
      sourceCode: source,
      startLine: 1,
      endLine: lines.length,
    })

    for (const entity of entities) {
      const entityType = this.mapEntityType(entity.type)
      if (!entityType)
        continue

      const qualifiedName = entity.parent ? `${entity.parent}.${entity.name}` : entity.name

      // Extract source code for this entity
      let entitySource: string | undefined
      if (entity.startLine !== undefined && entity.endLine !== undefined) {
        entitySource = lines.slice(entity.startLine - 1, entity.endLine).join('\n')
      }

      const id = `${filePath}:${entityType}:${qualifiedName}`

      result.push({
        id,
        filePath,
        entityType,
        entityName: entity.name,
        qualifiedName,
        sourceCode: entitySource,
        startLine: entity.startLine,
        endLine: entity.endLine,
      })
    }

    return result
  }

  /**
   * Diff old and new entity sets by qualified name to produce U+, U-, U~ sets
   */
  private diffEntities(
    oldEntities: ChangedEntity[],
    newEntities: ChangedEntity[],
    result: DiffResult,
  ): void {
    const oldMap = new Map<string, ChangedEntity>()
    for (const entity of oldEntities) {
      oldMap.set(entity.id, entity)
    }

    const newMap = new Map<string, ChangedEntity>()
    for (const entity of newEntities) {
      newMap.set(entity.id, entity)
    }

    // Entities only in old → deletions (U-)
    for (const [id, entity] of oldMap) {
      if (!newMap.has(id)) {
        result.deletions.push(entity)
      }
    }

    // Entities only in new → insertions (U+)
    for (const [id, entity] of newMap) {
      if (!oldMap.has(id)) {
        result.insertions.push(entity)
      }
    }

    // Entities in both → check if source changed → modifications (U~)
    for (const [id, newEntity] of newMap) {
      const oldEntity = oldMap.get(id)
      if (oldEntity && oldEntity.sourceCode !== newEntity.sourceCode) {
        result.modifications.push({ old: oldEntity, new: newEntity })
      }
    }
  }

  /**
   * Map CodeEntity type to EntityType
   */
  private mapEntityType(type: CodeEntity['type']): EntityType | null {
    const map: Record<string, EntityType> = {
      function: 'function',
      class: 'class',
      method: 'method',
    }
    return (map[type] as EntityType) ?? null
  }

  /**
   * Parse commit range into [oldRev, newRev]
   */
  private parseCommitRange(commitRange: string): [string, string] {
    if (commitRange.includes('..')) {
      const parts = commitRange.split('..')
      const oldRev = parts[0] || commitRange
      const newRev = parts[1] || 'HEAD'
      return [oldRev, newRev]
    }
    // Single commit: compare with parent
    return [`${commitRange}~1`, commitRange]
  }

  /**
   * Validate commit range to prevent git argument injection.
   * Rejects values starting with '-' that git would interpret as flags.
   */
  private validateCommitRange(commitRange: string): void {
    if (commitRange.startsWith('-')) {
      throw new Error(`Invalid commit range "${commitRange}": must not start with "-"`)
    }
    // Validate each part of a range (e.g., "abc..def")
    for (const part of commitRange.split('..')) {
      if (part.startsWith('-')) {
        throw new Error(`Invalid commit range "${commitRange}": revision must not start with "-"`)
      }
    }
  }

  /**
   * Check if a file is supported for AST parsing
   */
  private isSupported(filePath: string): boolean {
    const language = this.astParser.detectLanguage(filePath)
    return language !== 'unknown' && this.astParser.isLanguageSupported(language)
  }

  /**
   * Execute a git command in the repo
   */
  private execGit(args: string[]): string {
    try {
      const stdout = execFileSync('git', args, {
        cwd: this.repoPath,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB
      })
      return stdout
    }
    catch (error: unknown) {
      const err = error as { stderr?: string, status?: number }
      throw new Error(
        `git ${args[0]} failed (exit ${err.status ?? 1}): ${(err.stderr ?? '').trim()}`,
      )
    }
  }
}
