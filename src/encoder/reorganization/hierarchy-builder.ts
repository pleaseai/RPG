import type { RepositoryPlanningGraph } from '../../graph'
import type { LLMClient } from '../../utils/llm'
import type { FileFeatureGroup } from './types'
import { buildHierarchicalConstructionPrompt, parseSolutionTag } from './prompts'

/**
 * Hierarchy Builder — construct 3-level semantic hierarchy from functional areas.
 *
 * Implements paper §3.2 Step 2: "Hierarchical Aggregation"
 * - Assigns file groups to 3-level paths
 * - Creates HighLevelNodes for each path segment
 * - Creates FunctionalEdges for the hierarchy
 * - Links file LowLevelNodes to their leaf HighLevelNodes
 */
export class HierarchyBuilder {
  constructor(
    private rpg: RepositoryPlanningGraph,
    private llmClient: LLMClient,
  ) {}

  async build(functionalAreas: string[], fileGroups: FileFeatureGroup[]): Promise<void> {
    const assignments = await this.getAssignments(functionalAreas, fileGroups)

    // Build a map: groupLabel → file node IDs
    const groupToFileIds = new Map<string, string[]>()
    for (const group of fileGroups) {
      groupToFileIds.set(
        group.groupLabel,
        group.fileFeatures.map(f => f.fileId),
      )
    }

    // Track created nodes to avoid duplicates
    const createdNodes = new Set<string>()

    // Process each assignment path
    for (const [pathStr, groupLabels] of Object.entries(assignments)) {
      const segments = pathStr.split('/')
      if (segments.length !== 3) {
        continue // Skip invalid paths (should have been validated)
      }

      const [area, category, subcategory] = segments as [string, string, string]

      // Create Level 0: Functional area
      const areaId = `domain:${area}`
      if (!createdNodes.has(areaId)) {
        createdNodes.add(areaId)
        await this.rpg.addHighLevelNode({
          id: areaId,
          feature: {
            description: `provide ${this.humanize(area)} functionality`,
            keywords: [area.toLowerCase()],
          },
        })
      }

      // Create Level 1: Category
      const categoryId = `domain:${area}/${category}`
      if (!createdNodes.has(categoryId)) {
        createdNodes.add(categoryId)
        await this.rpg.addHighLevelNode({
          id: categoryId,
          feature: {
            description: category,
            keywords: category.split(/\s+/),
          },
        })
        await this.rpg.addFunctionalEdge({ source: areaId, target: categoryId })
      }

      // Create Level 2: Subcategory
      const subcategoryId = `domain:${area}/${category}/${subcategory}`
      if (!createdNodes.has(subcategoryId)) {
        createdNodes.add(subcategoryId)
        await this.rpg.addHighLevelNode({
          id: subcategoryId,
          feature: {
            description: subcategory,
            keywords: subcategory.split(/\s+/),
          },
        })
        await this.rpg.addFunctionalEdge({ source: categoryId, target: subcategoryId })
      }

      // Link file LowLevelNodes to subcategory
      for (const label of groupLabels) {
        const fileIds = groupToFileIds.get(label)
        if (!fileIds)
          continue
        for (const fileId of fileIds) {
          const hasNode = await this.rpg.hasNode(fileId)
          if (hasNode) {
            await this.rpg.addFunctionalEdge({ source: subcategoryId, target: fileId })
          }
        }
      }
    }

    // Handle unassigned files: files not covered by any assignment
    await this.handleUnassignedFiles(fileGroups, assignments, createdNodes)
  }

  private async getAssignments(
    functionalAreas: string[],
    fileGroups: FileFeatureGroup[],
  ): Promise<Record<string, string[]>> {
    const { system, user } = buildHierarchicalConstructionPrompt(functionalAreas, fileGroups)

    let response: string
    try {
      const result = await this.llmClient.complete(user, system)
      response = result.content
    }
    catch (err) {
      throw new Error(
        `Hierarchical Construction LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    let mapping: Record<string, string[]>
    try {
      mapping = parseSolutionTag<Record<string, string[]>>(response)
      this.validatePaths(mapping)
    }
    catch (parseErr) {
      // Retry once with format correction
      const retryResult = await this.llmClient.complete(
        `${user}\n\nIMPORTANT: Your previous response was invalid. ${parseErr instanceof Error ? parseErr.message : ''}\nEach path MUST have EXACTLY 3 levels separated by "/". Please respond with ONLY a JSON object mapping 3-level paths to arrays of group labels, wrapped in <solution> tags.`,
        system,
      )
      mapping = parseSolutionTag<Record<string, string[]>>(retryResult.content)
      this.validatePaths(mapping)
    }

    return mapping
  }

  private validatePaths(mapping: Record<string, string[]>): void {
    for (const pathStr of Object.keys(mapping)) {
      const segments = pathStr.split('/')
      if (segments.length !== 3) {
        throw new Error(
          `Invalid hierarchy path "${pathStr}": expected exactly 3 levels (functional_area/category/subcategory), got ${segments.length}`,
        )
      }
      for (const segment of segments) {
        if (!segment || segment.trim().length === 0) {
          throw new Error(`Invalid hierarchy path "${pathStr}": contains empty segment`)
        }
      }
    }
  }

  private async handleUnassignedFiles(
    fileGroups: FileFeatureGroup[],
    assignments: Record<string, string[]>,
    createdNodes: Set<string>,
  ): Promise<void> {
    // Collect all assigned group labels
    const assignedLabels = new Set<string>()
    for (const labels of Object.values(assignments)) {
      for (const label of labels) {
        assignedLabels.add(label)
      }
    }

    // Find unassigned groups
    const unassigned = fileGroups.filter(g => !assignedLabels.has(g.groupLabel))
    if (unassigned.length === 0)
      return

    // Create Uncategorized functional area
    const areaId = 'domain:Uncategorized'
    if (!createdNodes.has(areaId)) {
      createdNodes.add(areaId)
      await this.rpg.addHighLevelNode({
        id: areaId,
        feature: {
          description: 'provide uncategorized functionality',
          keywords: ['uncategorized'],
        },
      })
    }

    const categoryId = 'domain:Uncategorized/general purpose'
    if (!createdNodes.has(categoryId)) {
      createdNodes.add(categoryId)
      await this.rpg.addHighLevelNode({
        id: categoryId,
        feature: {
          description: 'general purpose',
          keywords: ['general'],
        },
      })
      await this.rpg.addFunctionalEdge({ source: areaId, target: categoryId })
    }

    const subcategoryId = 'domain:Uncategorized/general purpose/miscellaneous'
    if (!createdNodes.has(subcategoryId)) {
      createdNodes.add(subcategoryId)
      await this.rpg.addHighLevelNode({
        id: subcategoryId,
        feature: {
          description: 'miscellaneous',
          keywords: ['misc'],
        },
      })
      await this.rpg.addFunctionalEdge({ source: categoryId, target: subcategoryId })
    }

    // Link unassigned file nodes
    for (const group of unassigned) {
      for (const file of group.fileFeatures) {
        const hasNode = await this.rpg.hasNode(file.fileId)
        if (hasNode) {
          await this.rpg.addFunctionalEdge({ source: subcategoryId, target: file.fileId })
        }
      }
    }
  }

  private humanize(pascalCase: string): string {
    return pascalCase.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  }
}
