/**
 * Backend-agnostic tree-sitter type declarations for soop-namu.
 *
 * These describe the `NamuNode` / `NamuParser` / `NamuTree` surface consumed by
 * `@pleaseai/soop-ast` and `@pleaseai/soop-encoder`. The active backend
 * (@kreuzberg/tree-sitter-language-pack, native NAPI) is bridged to this surface
 * by the adapter, so consumers stay decoupled from the underlying engine.
 */

/**
 * Languages with tuned extraction support in soop-namu / soop-ast.
 */
export type SupportedLanguage = 'typescript' | 'javascript' | 'python' | 'rust' | 'go' | 'java' | 'csharp' | 'c' | 'cpp' | 'ruby' | 'kotlin'
export interface NamuPoint {
  row: number
  column: number
}

export interface NamuNode {
  type: string
  text: string
  children: NamuNode[]
  namedChildren: NamuNode[]
  childCount: number
  namedChildCount: number
  startPosition: NamuPoint
  endPosition: NamuPoint
  startIndex: number
  endIndex: number
  parent: NamuNode | null
  hasError: boolean
  isNamed: boolean
  isMissing: boolean
  childForFieldName: (fieldName: string) => NamuNode | null
  child: (index: number) => NamuNode | null
  namedChild: (index: number) => NamuNode | null
  nextSibling: NamuNode | null
  previousSibling: NamuNode | null
  toString: () => string
}

export interface NamuTree {
  rootNode: NamuNode
  copy: () => NamuTree
  delete: () => void
}

export interface NamuLanguage {
  readonly version: number
}

export interface NamuParser {
  setLanguage: (language: NamuLanguage | null) => void
  parse: (input: string) => NamuTree
  delete: () => void
}
