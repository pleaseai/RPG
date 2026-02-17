import type { CallSite, InheritanceRelation } from './dependency-graph'
import { createLogger } from '@pleaseai/rpg-utils/logger'
import { resolveImportPath } from './dependency-injection'

const log = createLogger('SymbolResolver')

/**
 * Represents a resolved call site with target file information
 */
export interface ResolvedCall {
  sourceFile: string
  sourceEntity?: string
  targetFile: string
  targetSymbol: string
  line?: number
}

/**
 * Represents a resolved inheritance relationship with target file information
 */
export interface ResolvedInheritance {
  childFile: string
  childClass: string
  parentFile: string
  parentClass: string
  kind: 'inherit' | 'implement'
}

/**
 * Symbol table mapping symbols to their source files
 */
export interface SymbolTable {
  // Map from symbol name to the file(s) that define/export it
  exports: Map<string, string[]>
  // Map from file path to its imported symbols
  imports: Map<string, Map<string, string>>
}

/**
 * Resolves call sites and inheritance relations to their target files
 * using import graph information from the AST
 */
export class SymbolResolver {
  private symbolTable: SymbolTable = {
    exports: new Map(),
    imports: new Map(),
  }

  /**
   * Build the symbol table from parse results
   * Pass 1: Record all exported symbols (what each file defines)
   * Pass 2: Record all imported symbols (what each file imports)
   */
  buildSymbolTable(
    files: Array<{
      filePath: string
      parseResult: { imports: Array<{ module: string, names: string[] }> }
      entities: Array<{ name: string }>
    }>,
  ): void {
    // Pass 1: Record all exported symbols
    this.indexExportedSymbols(files)

    // Pass 2: Record all imported symbols
    const knownFiles = new Set(files.map(f => f.filePath))
    this.indexImportedSymbols(files, knownFiles)

    log.debug(`Built symbol table: ${this.symbolTable.exports.size} unique symbols, ${this.symbolTable.imports.size} files with imports`)
  }

  /**
   * Index all symbols exported (defined) by each file
   */
  private indexExportedSymbols(files: Array<{ filePath: string, entities: Array<{ name: string }> }>): void {
    for (const file of files) {
      for (const entity of file.entities) {
        if (!this.symbolTable.exports.has(entity.name)) {
          this.symbolTable.exports.set(entity.name, [])
        }
        const targets = this.symbolTable.exports.get(entity.name)
        if (targets && !targets.includes(file.filePath)) {
          targets.push(file.filePath)
        }
      }
    }
  }

  /**
   * Index all symbols imported by each file
   */
  private indexImportedSymbols(
    files: Array<{ filePath: string, parseResult: { imports: Array<{ module: string, names: string[] }> } }>,
    knownFiles: Set<string>,
  ): void {
    for (const file of files) {
      const importMap = new Map<string, string>()

      for (const imp of file.parseResult.imports) {
        // Resolve the import path to an actual file
        const resolvedPath = resolveImportPath(file.filePath, imp.module, knownFiles)
        if (!resolvedPath) {
          continue
        }

        // Map each imported name to its source file
        for (const name of imp.names) {
          importMap.set(name, resolvedPath)
        }
      }

      if (importMap.size > 0) {
        this.symbolTable.imports.set(file.filePath, importMap)
      }
    }
  }

  /**
   * Resolve a call site to its target file
   */
  resolveCall(call: CallSite, knownFiles: Set<string>): ResolvedCall | null {
    const targetFile = this.resolveSymbolLocation(call.callerFile, call.calleeSymbol, knownFiles)

    if (!targetFile) {
      return null
    }

    return {
      sourceFile: call.callerFile,
      sourceEntity: call.callerEntity,
      targetFile,
      targetSymbol: call.calleeSymbol,
      line: call.line,
    }
  }

  /**
   * Resolve an inheritance relation to its target file
   */
  resolveInheritance(relation: InheritanceRelation, knownFiles: Set<string>): ResolvedInheritance | null {
    const targetFile = this.resolveSymbolLocation(relation.childFile, relation.parentClass, knownFiles)

    if (!targetFile) {
      return null
    }

    return {
      childFile: relation.childFile,
      childClass: relation.childClass,
      parentFile: targetFile,
      parentClass: relation.parentClass,
      kind: relation.kind,
    }
  }

  /**
   * Batch resolve multiple calls, filtering out unresolvable ones
   */
  resolveAllCalls(calls: CallSite[], knownFiles: Set<string>): ResolvedCall[] {
    return calls
      .map(call => this.resolveCall(call, knownFiles))
      .filter((resolved): resolved is ResolvedCall => resolved !== null)
  }

  /**
   * Batch resolve multiple inheritances, filtering out unresolvable ones
   */
  resolveAllInheritances(relations: InheritanceRelation[], knownFiles: Set<string>): ResolvedInheritance[] {
    return relations
      .map(relation => this.resolveInheritance(relation, knownFiles))
      .filter((resolved): resolved is ResolvedInheritance => resolved !== null)
  }

  /**
   * Resolve a symbol to its defining file using import/export graph
   *
   * Resolution Strategy (in order):
   * 1. **Direct import**: Check if symbol is explicitly imported in `fromFile`
   * 2. **Same-file definition**: Check if symbol is defined in `fromFile`
   * 3. **Global export**: Resolve to the first file that exports the symbol
   * 4. **Fuzzy matching**: Try case-insensitive matching and recurse (fallback for casing issues)
   *
   * Returns null if symbol cannot be resolved to any file.
   */
  private resolveSymbolLocation(fromFile: string, symbol: string, knownFiles: Set<string>): string | null {
    // Strategy 1: Direct import match (symbol is imported in the file)
    const importedTarget = this.getImportedSymbolTarget(fromFile, symbol)
    if (importedTarget) {
      return importedTarget
    }

    // Strategy 2: Same-file definition (symbol is defined in the same file)
    const exportsForSymbol = this.symbolTable.exports.get(symbol)
    if (exportsForSymbol?.includes(fromFile)) {
      return fromFile
    }

    // Strategy 3: Global export (symbol exported by some file)
    if (exportsForSymbol && exportsForSymbol.length > 0) {
      const firstExport = exportsForSymbol[0]
      if (firstExport) {
        return firstExport
      }
    }

    // Strategy 4: Fuzzy match (case-insensitive) - conservative fallback
    const fuzzyMatch = this.fuzzyMatchSymbol(symbol)
    if (fuzzyMatch) {
      return this.resolveSymbolLocation(fromFile, fuzzyMatch, knownFiles)
    }

    return null
  }

  /**
   * Get the target file for an imported symbol
   */
  private getImportedSymbolTarget(fromFile: string, symbol: string): string | null {
    const importMap = this.symbolTable.imports.get(fromFile)
    if (importMap?.has(symbol)) {
      const target = importMap.get(symbol)
      return target || null
    }
    return null
  }

  /**
   * Attempt case-insensitive fuzzy matching
   */
  private fuzzyMatchSymbol(symbol: string): string | null {
    const lowerSymbol = symbol.toLowerCase()

    for (const exported of this.symbolTable.exports.keys()) {
      if (exported.toLowerCase() === lowerSymbol && exported !== symbol) {
        return exported
      }
    }

    return null
  }
}
