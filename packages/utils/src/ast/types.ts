/**
 * Parsed code entity from AST
 */
export interface CodeEntity {
  /** Entity type */
  type: 'function' | 'class' | 'method'
  /** Entity name */
  name: string
  /** Start line (1-indexed) */
  startLine: number
  /** End line (1-indexed) */
  endLine: number
  /** Start column */
  startColumn: number
  /** End column */
  endColumn: number
  /** Docstring or comment */
  documentation?: string
  /** Parameters for functions/methods */
  parameters?: string[]
  /** Return type annotation */
  returnType?: string
  /** Parent entity (for methods) */
  parent?: string
}

/**
 * Result of parsing a file
 */
export interface ParseResult {
  /** Detected language */
  language: string
  /** Extracted entities */
  entities: CodeEntity[]
  /** Import statements */
  imports: Array<{ module: string, names: string[] }>
  /** Parsing errors */
  errors: string[]
}

/**
 * Supported language names
 */
export type SupportedLanguage = 'typescript' | 'javascript' | 'python' | 'rust' | 'go' | 'java'

/**
 * Language configurations with parser and settings
 */
export interface LanguageConfig {
  parser: unknown
  entityTypes: Record<string, CodeEntity['type']>
  importTypes: string[]
}
