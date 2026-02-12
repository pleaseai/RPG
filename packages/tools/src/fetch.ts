import type { GitHubSource, RepositoryPlanningGraph } from '@pleaseai/rpg-graph'
import type { Node } from '@pleaseai/rpg-graph/node'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

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
}

/**
 * Fetch result
 */
export interface FetchResult {
  /** Fetched entities */
  entities: EntityDetail[]
  /** Entities not found */
  notFound: string[]
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
  private rpg: RepositoryPlanningGraph
  private mode: SourceMode
  private rootPath: string | null
  private github: GitHubSource | null

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
        entities.push({
          node,
          sourceCode,
          featurePaths: await this.getFeaturePaths(node.id),
        })
      }
      else {
        notFound.push(id)
      }
    }

    return { entities, notFound }
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
