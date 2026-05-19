import type { GitHubSource, RepositoryPlanningGraph } from '@pleaseai/soop-graph'
import type { Node } from '@pleaseai/soop-graph/node'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { suggestNodes } from '@pleaseai/soop-graph/fuzzy'

/**
 * Source resolution mode for FetchNode
 */
export type SourceMode = 'filesystem' | 'github' | 'embedded'

/**
 * Options for FetchNode
 */
export interface FetchOptions {
  /** Code entity identifiers to fetch */
  codeEntities?: string[]
  /** Feature path identifiers to fetch */
  featureEntities?: string[]
}

/**
 * Fetch result for a single entity
 */
export interface EntityDetail {
  /** Node data */
  node: Node
  /** Source code */
  sourceCode?: string
  /** Related feature paths */
  featurePaths: string[]
  /**
   * For file-type nodes: distinct feature descriptions implemented by
   * descendant entities (classes, functions, methods inside the file).
   * Mirrors the Python `get_node_detail`/`all_features` aggregation.
   */
  allFeatures?: string[]
}

/**
 * Fetch result
 */
export interface FetchResult {
  /** Fetched entities */
  entities: EntityDetail[]
  /** Entities not found */
  notFound: string[]
  /** Suggested similar node IDs aggregated across all notFound entries (up to 5) */
  suggestions?: string[]
}

/**
 * FetchNode configuration
 */
export interface FetchNodeConfig {
  /** Source resolution mode */
  mode?: SourceMode
  /** Root path override (filesystem mode) */
  rootPath?: string
  /** GitHub source override (github mode) */
  github?: GitHubSource
}

/**
 * FetchNode - Retrieve precise metadata and source context
 *
 * Three source resolution modes:
 * - filesystem: reads from rootPath + metadata.path (local dev, CI)
 * - github: fetches from raw.githubusercontent.com (sandbox, deployment)
 * - embedded: reads from node.sourceCode field (offline, bundled RPG)
 */
export class FetchNode {
  private readonly rpg: RepositoryPlanningGraph
  private readonly mode: SourceMode
  private readonly rootPath: string | null
  private readonly github: GitHubSource | null

  constructor(rpg: RepositoryPlanningGraph, config?: FetchNodeConfig) {
    this.rpg = rpg
    const rpgConfig = rpg.getConfig()

    this.rootPath = config?.rootPath ?? rpgConfig.rootPath ?? null
    this.github = config?.github ?? rpgConfig.github ?? null

    // Auto-detect mode if not specified
    if (config?.mode) {
      this.mode = config.mode
    }
    else if (this.rootPath) {
      this.mode = 'filesystem'
    }
    else if (this.github) {
      this.mode = 'github'
    }
    else {
      this.mode = 'embedded'
    }
  }

  /**
   * Fetch entities by ID
   */
  async get(options: FetchOptions): Promise<FetchResult> {
    const entities: EntityDetail[] = []
    const notFound: string[] = []

    const allIds = [...(options.codeEntities ?? []), ...(options.featureEntities ?? [])]

    for (const id of allIds) {
      const node = await this.rpg.getNode(id)
      if (node) {
        const sourceCode = await this.readSource(node)
        const detail: EntityDetail = {
          node,
          sourceCode,
          featurePaths: await this.getFeaturePaths(node.id),
        }
        if (node.metadata?.entityType === 'file') {
          const allFeatures = await this.aggregateDescendantFeatures(node.id)
          if (allFeatures.length > 0) {
            detail.allFeatures = allFeatures
          }
        }
        entities.push(detail)
      }
      else {
        notFound.push(id)
      }
    }

    if (notFound.length === 0) {
      return { entities, notFound }
    }

    const suggestions = await this.collectSuggestions(notFound)
    return suggestions.length > 0
      ? { entities, notFound, suggestions }
      : { entities, notFound }
  }

  /**
   * Aggregate suggestions across all not-found IDs, deduplicated and ranked.
   */
  private async collectSuggestions(notFound: string[]): Promise<string[]> {
    const seen = new Set<string>()
    const ordered: string[] = []
    for (const id of notFound) {
      const suggestions = await suggestNodes(this.rpg, id, { limit: 5 })
      for (const suggestion of suggestions) {
        if (!seen.has(suggestion)) {
          seen.add(suggestion)
          ordered.push(suggestion)
        }
      }
    }
    return ordered.slice(0, 5)
  }

  /**
   * Read source code based on the configured mode.
   * Falls back to embedded source if the primary mode returns nothing.
   */
  private async readSource(node: Node): Promise<string | undefined> {
    let source: string | undefined
    switch (this.mode) {
      case 'filesystem':
        source = await this.readFromFilesystem(node)
        break
      case 'github':
        source = await this.readFromGitHub(node)
        break
      case 'embedded':
        return this.readEmbedded(node)
    }
    return source ?? this.readEmbedded(node)
  }

  /**
   * Read embedded source from node's sourceCode field
   */
  private readEmbedded(node: Node): string | undefined {
    return 'sourceCode' in node ? (node as Record<string, unknown>).sourceCode as string : undefined
  }

  /**
   * Read source from local filesystem
   */
  private async readFromFilesystem(node: Node): Promise<string | undefined> {
    const filePath = node.metadata?.path
    if (!filePath || !this.rootPath) {
      return undefined
    }

    try {
      const fullPath = resolve(join(this.rootPath, filePath))
      const content = await readFile(fullPath, 'utf-8')
      return this.extractLines(content, node)
    }
    catch {
      return undefined
    }
  }

  /**
   * Fetch source from GitHub raw content
   */
  private async readFromGitHub(node: Node): Promise<string | undefined> {
    const filePath = node.metadata?.path
    if (!filePath || !this.github) {
      return undefined
    }

    const { owner, repo, commit, pathPrefix } = this.github
    const remotePath = pathPrefix ? `${pathPrefix}/${filePath}` : filePath
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${commit}/${remotePath}`

    try {
      const response = await fetch(url)
      if (!response.ok) {
        return undefined
      }
      const content = await response.text()
      return this.extractLines(content, node)
    }
    catch {
      return undefined
    }
  }

  /**
   * Extract relevant lines from source content based on node metadata
   */
  private extractLines(content: string, node: Node): string {
    const startLine = node.metadata?.startLine
    const endLine = node.metadata?.endLine
    if (startLine != null && endLine != null) {
      const lines = content.split('\n')
      return lines.slice(startLine - 1, endLine).join('\n')
    }
    return content
  }

  /**
   * Aggregate distinct feature descriptions from all descendants of a file node.
   * Mirrors Python `get_node_detail` for `type=file`.
   */
  private async aggregateDescendantFeatures(fileNodeId: string): Promise<string[]> {
    const collected = new Set<string>()
    const stack = [fileNodeId]
    const visited = new Set<string>()
    while (stack.length > 0) {
      const current = stack.pop()!
      if (visited.has(current))
        continue
      visited.add(current)
      const children = await this.rpg.getChildren(current)
      for (const child of children) {
        const desc = child.feature.description?.trim()
        if (desc)
          collected.add(desc)
        if (!visited.has(child.id))
          stack.push(child.id)
      }
    }
    return [...collected].sort()
  }

  /**
   * Get feature paths for a node by traversing functional edges
   */
  private async getFeaturePaths(nodeId: string): Promise<string[]> {
    const paths: string[] = []
    let current = await this.rpg.getNode(nodeId)

    while (current) {
      paths.unshift(current.feature.description)
      current = await this.rpg.getParent(current.id)
    }

    return [paths.join(' / ')]
  }
}
