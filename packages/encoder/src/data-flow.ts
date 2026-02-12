import type { DataFlowEdge } from '@pleaseai/rpg-graph/edge'
import type { ParseResult } from '@pleaseai/rpg-utils/ast'
import path from 'node:path'
import { DataFlowEdgeSchema } from '@pleaseai/rpg-graph/edge'

/**
 * Options for DataFlowDetector
 */
export interface DataFlowDetectorOptions {
  /** Repository path */
  repoPath: string
}

/**
 * Information about a parsed file for data flow analysis
 */
export interface FileParseInfo {
  /** Relative file path */
  filePath: string
  /** RPG node ID for this file */
  nodeId: string
  /** Parse result containing entities and imports */
  parseResult: ParseResult
  /** Optional source code content */
  sourceCode?: string
}

/**
 * Detects data flows within and between modules
 *
 * T001: Inter-module data flows through imports
 * T002: Intra-module data flows through function calls and variable chains
 */
export class DataFlowDetector {
  constructor(_options: DataFlowDetectorOptions) {
    // Options available for potential future use in path resolution
  }

  /**
   * Detect inter-module data flows through imports
   *
   * For each file that imports symbols from other files, create a DataFlowEdge
   * from the source module to the importing module with the imported symbol as dataId
   */
  detectInterModuleFlows(files: FileParseInfo[]): DataFlowEdge[] {
    const flows: DataFlowEdge[] = []

    // Map file paths to node IDs for quick lookup
    const filePathToNodeId = new Map<string, string>()
    for (const file of files) {
      // Normalize path for comparison
      const normalized = this.normalizePath(file.filePath)
      filePathToNodeId.set(normalized, file.nodeId)
    }

    // Process each file's imports
    for (const file of files) {
      for (const importInfo of file.parseResult.imports) {
        // Skip external module imports (those not starting with . or /)
        if (!importInfo.module.startsWith('.') && !importInfo.module.startsWith('/')) {
          continue
        }

        // Resolve the module path relative to the current file
        const importedFilePath = this.resolveImportPath(file.filePath, importInfo.module)
        const normalizedImportPath = this.normalizePath(importedFilePath)

        // Find the imported file's node ID
        const importedNodeId = filePathToNodeId.get(normalizedImportPath)
        if (!importedNodeId) {
          // Module not found in the file list, skip
          continue
        }

        // Create a data flow edge for each imported symbol
        for (const symbolName of importInfo.names) {
          const edge = this.createValidatedEdge({
            from: importedNodeId,
            to: file.nodeId,
            dataId: symbolName,
            dataType: 'import',
          })
          if (edge) {
            flows.push(edge)
          }
        }
      }
    }

    return flows
  }

  /**
   * Detect intra-module data flows within a single file
   *
   * Detects variable chains, parameter passing, and return value usage
   */
  detectIntraModuleFlows(file: FileParseInfo): DataFlowEdge[] {
    const flows: DataFlowEdge[] = []

    // Without source code, we cannot reliably detect intra-module flows
    if (!file.sourceCode) {
      return flows
    }

    const parseResult = file.parseResult

    // If there are no entities or source, return empty
    if (parseResult.entities.length === 0) {
      return flows
    }

    // Detect variable chains - when one function calls another and uses the result
    // This is a simplified pattern: look for common patterns like:
    // const x = functionA(...); functionB(x)

    // For now, we'll detect parameter forwarding patterns
    // where a parameter is passed to another function call in the same scope

    const functions = parseResult.entities.filter(e => e.type === 'function')
    const sourceLines = file.sourceCode.split('\n')

    for (let i = 0; i < functions.length; i++) {
      const func = functions[i]

      if (!func) {
        continue
      }

      // Get the function body text (skip first line to avoid matching function signature)
      const funcStart = func.startLine - 1
      const funcEnd = func.endLine
      const funcLines = sourceLines.slice(funcStart, funcEnd)
      const funcBody = funcLines.join('\n')
      const funcBodyWithoutDecl = funcLines.slice(1).join('\n')

      // Detect parameter forwarding (using body without declaration to avoid false positives)
      this.detectParameterFlows(file.nodeId, funcBodyWithoutDecl, func.parameters, flows)

      // Detect variable chains
      this.detectVariableChains(file.nodeId, funcBody, flows)
    }

    return flows
  }

  /**
   * Detect both inter-module and intra-module flows
   */
  detectAll(files: FileParseInfo[]): DataFlowEdge[] {
    const allFlows: DataFlowEdge[] = []

    // Detect inter-module flows
    allFlows.push(...this.detectInterModuleFlows(files))

    // Detect intra-module flows for each file
    for (const file of files) {
      allFlows.push(...this.detectIntraModuleFlows(file))
    }

    // Deduplicate edges by (from, to, dataId, dataType) tuple
    const seen = new Set<string>()
    const flows: DataFlowEdge[] = []
    for (const edge of allFlows) {
      const key = `${edge.from}|${edge.to}|${edge.dataId}|${edge.dataType}`
      if (!seen.has(key)) {
        seen.add(key)
        flows.push(edge)
      }
    }

    return flows
  }

  /**
   * Resolve an import path relative to the importing file
   */
  private resolveImportPath(importerPath: string, importSpecifier: string): string {
    const directory = path.dirname(importerPath)

    // Handle relative imports
    let resolvedPath = path.join(directory, importSpecifier)

    // Add extension if not present
    if (!this.hasFileExtension(resolvedPath)) {
      // Try common extensions
      resolvedPath = `${resolvedPath}.ts`
    }

    return resolvedPath
  }

  /**
   * Check if a file path has a known source file extension
   */
  private hasFileExtension(filePath: string): boolean {
    return /\.(?:ts|tsx|js|jsx)$/.test(filePath)
  }

  /**
   * Normalize a file path for comparison (remove extensions, handle aliases)
   */
  private normalizePath(filePath: string): string {
    // Remove file extensions for comparison
    const withoutExt = filePath.replace(/\.(ts|tsx|js|jsx)$/, '')
    return withoutExt
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  /**
   * Check if a parameter is used in a function call within the function body
   */
  private isParameterUsedInFunctionCall(funcBody: string, paramName: string): boolean {
    const escaped = this.escapeRegex(paramName)
    const pattern = new RegExp(`\\w+\\(.*\\b${escaped}\\b.*\\)`)
    return pattern.test(funcBody)
  }

  /**
   * Find variable chains in function body
   * Returns variable names that are assigned and then used
   */
  private findVariableChains(funcBody: string): Set<string> {
    const variables = new Set<string>()

    // Pattern for variable declarations: const/let/var name = ...
    const declPattern = /(?:const|let|var)\s+(\w+)\s*=/g
    let match = declPattern.exec(funcBody)

    while (match !== null) {
      const varName = match[1]

      if (varName) {
        // Check if variable is used later in the function
        const usagePattern = new RegExp(`\\b${this.escapeRegex(varName)}\\b`, 'g')
        const matches = funcBody.match(usagePattern)

        if (matches && matches.length > 1) {
          // Variable is declared and used
          variables.add(varName)
        }
      }

      match = declPattern.exec(funcBody)
    }

    return variables
  }

  /**
   * Create and validate a DataFlowEdge
   * Returns the edge if valid, null otherwise
   */
  private createValidatedEdge(edge: DataFlowEdge): DataFlowEdge | null {
    const result = DataFlowEdgeSchema.safeParse(edge)
    if (result.success) {
      return result.data
    }
    console.warn(
      `[DataFlowDetector] Invalid DataFlowEdge (from=${edge.from}, to=${edge.to}, `
      + `dataId=${edge.dataId}): ${result.error.message}`,
    )
    return null
  }

  /**
   * Detect parameter forwarding flows in a function body
   */
  private detectParameterFlows(
    nodeId: string,
    funcBody: string,
    parameters: string[] | undefined,
    flows: DataFlowEdge[],
  ): void {
    if (!parameters || parameters.length === 0) {
      return
    }

    for (const param of parameters) {
      if (this.isParameterUsedInFunctionCall(funcBody, param)) {
        const edge = this.createValidatedEdge({
          from: nodeId,
          to: nodeId,
          dataId: param,
          dataType: 'parameter',
        })
        if (edge) {
          flows.push(edge)
        }
      }
    }
  }

  /**
   * Detect variable chain flows in a function body
   */
  private detectVariableChains(nodeId: string, funcBody: string, flows: DataFlowEdge[]): void {
    const variables = this.findVariableChains(funcBody)
    for (const varName of variables) {
      const edge = this.createValidatedEdge({
        from: nodeId,
        to: nodeId,
        dataId: varName,
        dataType: 'variable_chain',
      })
      if (edge) {
        flows.push(edge)
      }
    }
  }
}
