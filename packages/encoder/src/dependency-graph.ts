import type { DependencyType } from '@pleaseai/rpg-graph/edge'

/**
 * Represents a call site in the dependency graph
 */
export interface CallSite {
  callerFile: string
  callerEntity?: string
  calleeSymbol: string
  line?: number
  receiver?: string
  receiverKind?: 'self' | 'super' | 'variable' | 'none'
  qualifiedName?: string
}

/**
 * Represents an inheritance or implementation relationship
 */
export interface InheritanceRelation {
  childFile: string
  childClass: string
  parentClass: string
  kind: 'inherit' | 'implement'
}

/**
 * Result of dependency graph analysis containing calls and inheritances
 */
export interface DependencyGraphResult {
  calls: CallSite[]
  inheritances: InheritanceRelation[]
}

/**
 * Represents a dependency edge in the RPG graph
 */
export interface DependencyEdgeOutput {
  source: string
  target: string
  dependencyType: DependencyType
  symbol?: string
  line?: number
}

/**
 * Structured dependency analysis on top of the RPG edge system
 * Provides a lightweight, hierarchical dependency graph supporting
 * call analysis and inheritance tracking.
 */
export class DependencyGraph {
  private readonly calls: CallSite[] = []
  private readonly inheritances: InheritanceRelation[] = []

  /**
   * Add a call site to the graph
   */
  addCall(call: CallSite): void {
    this.calls.push(call)
  }

  /**
   * Add an inheritance relationship to the graph
   */
  addInheritance(relation: InheritanceRelation): void {
    this.inheritances.push(relation)
  }

  /**
   * Get all calls
   */
  getCalls(): CallSite[] {
    return this.calls
  }

  /**
   * Get calls by file path
   */
  getCallsByFile(filePath: string): CallSite[] {
    return this.calls.filter(call => call.callerFile === filePath)
  }

  /**
   * Get calls to a specific symbol
   */
  getCallsToSymbol(symbol: string): CallSite[] {
    return this.calls.filter(call => call.calleeSymbol === symbol)
  }

  /**
   * Get all inheritances
   */
  getInheritances(): InheritanceRelation[] {
    return this.inheritances
  }

  /**
   * Get inheritance relationships by child class name
   */
  getInheritancesByChild(className: string): InheritanceRelation[] {
    return this.inheritances.filter(relation => relation.childClass === className)
  }

  /**
   * Get inheritance relationships by parent class name
   */
  getInheritancesByParent(className: string): InheritanceRelation[] {
    return this.inheritances.filter(relation => relation.parentClass === className)
  }

  /**
   * Get the complete result containing both calls and inheritances
   */
  getResult(): DependencyGraphResult {
    return {
      calls: this.calls,
      inheritances: this.inheritances,
    }
  }

  /**
   * Convert to DependencyEdge[] for RPG integration
   * Skips entries where the node resolver returns null
   */
  toDependencyEdges(
    nodeResolver: (file: string, entity?: string) => string | null,
  ): DependencyEdgeOutput[] {
    const edges: DependencyEdgeOutput[] = []

    this.convertCallsToEdges(edges, nodeResolver)
    this.convertInheritancesToEdges(edges, nodeResolver)

    return edges
  }

  /**
   * Convert calls to dependency edges
   */
  private convertCallsToEdges(
    edges: DependencyEdgeOutput[],
    nodeResolver: (file: string, entity?: string) => string | null,
  ): void {
    for (const call of this.calls) {
      const source = nodeResolver(call.callerFile, call.callerEntity)
      if (!source)
        continue

      edges.push({
        source,
        target: '', // Target will be resolved separately
        dependencyType: 'call' as DependencyType,
        symbol: call.calleeSymbol,
        line: call.line,
      })
    }
  }

  /**
   * Convert inheritances to dependency edges
   */
  private convertInheritancesToEdges(
    edges: DependencyEdgeOutput[],
    nodeResolver: (file: string, entity?: string) => string | null,
  ): void {
    for (const inheritance of this.inheritances) {
      const source = nodeResolver(inheritance.childFile, inheritance.childClass)
      if (!source)
        continue

      const dependencyType: DependencyType
        = inheritance.kind === 'implement' ? 'implement' : 'inherit'

      edges.push({
        source,
        target: '', // Target will be resolved separately
        dependencyType,
      })
    }
  }
}
