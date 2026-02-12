/**
 * File-level feature group — input to Domain Discovery and Hierarchical Construction.
 *
 * Grouped by top-level directory for initial presentation to LLM.
 * The LLM then reorganizes these groups semantically, decoupling from the directory structure.
 */
export interface FileFeatureGroup {
  /** Top-level directory label used as grouping key for LLM input (e.g., "encoder", "graph") */
  groupLabel: string
  /** File-level semantic features within this group */
  fileFeatures: Array<{
    fileId: string
    filePath: string
    description: string
    keywords: string[]
  }>
}

/**
 * Domain Discovery output — identified functional areas from LLM analysis.
 */
export interface DomainDiscoveryResult {
  /** Identified functional areas (PascalCase, e.g., "DataProcessing") */
  functionalAreas: string[]
}

/**
 * Hierarchical Construction output — maps 3-level paths to group labels.
 */
export interface HierarchicalMapping {
  /**
   * Maps 3-level path → array of group labels (from FileFeatureGroup.groupLabel)
   * e.g., "DataProcessing/pipeline orchestration/task scheduling": ["data_loader", "dataset"]
   */
  assignments: Record<string, string[]>
}
