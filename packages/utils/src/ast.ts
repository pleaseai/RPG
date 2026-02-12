import Parser from 'tree-sitter'

// Tree-sitter language parsers - using require for CommonJS modules
const TypeScript = require('tree-sitter-typescript').typescript
const Python = require('tree-sitter-python')

/**
 * Parsed code entity from AST
 */
export interface CodeEntity {
  /** Entity type */
  type: 'function' | 'class' | 'method' | 'variable' | 'import'
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
type SupportedLanguage = 'typescript' | 'javascript' | 'python'

/**
 * Node types that represent splittable code units per language
 */
const ENTITY_NODE_TYPES: Record<SupportedLanguage, Record<string, CodeEntity['type']>> = {
  typescript: {
    function_declaration: 'function',
    arrow_function: 'function',
    class_declaration: 'class',
    method_definition: 'method',
    // export_statement: handled separately for imports
  },
  javascript: {
    function_declaration: 'function',
    arrow_function: 'function',
    class_declaration: 'class',
    method_definition: 'method',
  },
  python: {
    function_definition: 'function',
    async_function_definition: 'function',
    class_definition: 'class',
  },
}

/**
 * Import node types per language
 */
const IMPORT_NODE_TYPES: Record<SupportedLanguage, string[]> = {
  typescript: ['import_statement'],
  javascript: ['import_statement'],
  python: ['import_statement', 'import_from_statement'],
}

/**
 * Language configurations with parser and settings
 */
interface LanguageConfig {
  parser: unknown
  entityTypes: Record<string, CodeEntity['type']>
  importTypes: string[]
}

const LANGUAGE_CONFIGS: Record<SupportedLanguage, LanguageConfig> = {
  typescript: {
    parser: TypeScript,
    entityTypes: ENTITY_NODE_TYPES.typescript,
    importTypes: IMPORT_NODE_TYPES.typescript,
  },
  javascript: {
    parser: TypeScript, // TypeScript parser handles JS as well
    entityTypes: ENTITY_NODE_TYPES.javascript,
    importTypes: IMPORT_NODE_TYPES.javascript,
  },
  python: {
    parser: Python,
    entityTypes: ENTITY_NODE_TYPES.python,
    importTypes: IMPORT_NODE_TYPES.python,
  },
}

/**
 * AST Parser using tree-sitter
 *
 * Extracts code structure for dependency analysis and semantic lifting.
 */
export class ASTParser {
  private parser: Parser

  constructor() {
    this.parser = new Parser()
  }

  /**
   * Check if a language is supported
   */
  isLanguageSupported(language: string): boolean {
    return this.isSupportedLanguage(language)
  }

  /**
   * Type guard to check if language is a supported language
   */
  private isSupportedLanguage(language: string): language is SupportedLanguage {
    return language in LANGUAGE_CONFIGS
  }

  /**
   * Detect language from file extension
   */
  detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase()
    const langMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      rs: 'rust',
      go: 'go',
      java: 'java',
      kt: 'kotlin',
      dart: 'dart',
    }
    return langMap[ext ?? ''] ?? 'unknown'
  }

  /**
   * Parse a source file
   */
  async parse(source: string, language: string): Promise<ParseResult> {
    const result: ParseResult = {
      language,
      entities: [],
      imports: [],
      errors: [],
    }

    // Handle empty source
    if (!source.trim()) {
      return result
    }

    // Check if language is supported
    if (!this.isSupportedLanguage(language)) {
      result.errors.push(`Unsupported language: ${language}`)
      return result
    }
    const config = LANGUAGE_CONFIGS[language]

    try {
      // Set language parser
      this.parser.setLanguage(
        config.parser as unknown as Parameters<typeof this.parser.setLanguage>[0],
      )

      // Parse the source
      const tree = this.parser.parse(source)

      if (!tree.rootNode) {
        result.errors.push('Failed to parse source code')
        return result
      }

      // Check for syntax errors in the tree
      if (tree.rootNode.hasError) {
        result.errors.push('Syntax error in source code')
      }

      // Extract entities and imports
      this.extractFromNode(tree.rootNode, source, config, result)
    }
    catch (error) {
      result.errors.push(`Parse error: ${error instanceof Error ? error.message : String(error)}`)
    }

    return result
  }

  /**
   * Parse a file from path
   */
  async parseFile(filePath: string): Promise<ParseResult> {
    const fs = await import('node:fs/promises')
    const source = await fs.readFile(filePath, 'utf-8')
    const language = this.detectLanguage(filePath)
    return this.parse(source, language)
  }

  /**
   * Extract entities and imports from AST node recursively
   */
  private extractFromNode(
    node: Parser.SyntaxNode,
    source: string,
    config: LanguageConfig,
    result: ParseResult,
  ): void {
    const nodeType = node.type

    // Check if this is an entity node
    const entityType = config.entityTypes[nodeType]
    if (entityType) {
      const entity = this.extractEntity(node, source, entityType)
      if (entity) {
        result.entities.push(entity)
      }
    }

    // Check if this is an import node
    if (config.importTypes.includes(nodeType)) {
      const importInfo = this.extractImport(node, source, result.language)
      if (importInfo) {
        result.imports.push(importInfo)
      }
    }

    // Recurse into children
    for (const child of node.children) {
      this.extractFromNode(child, source, config, result)
    }
  }

  /**
   * Extract entity information from a node
   */
  private extractEntity(
    node: Parser.SyntaxNode,
    source: string,
    entityType: CodeEntity['type'],
  ): CodeEntity | null {
    const name = this.extractEntityName(node, entityType)
    if (!name)
      return null

    const entity: CodeEntity = {
      type: entityType,
      name,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
    }

    // Extract parameters for functions/methods
    if (entityType === 'function' || entityType === 'method') {
      entity.parameters = this.extractParameters(node)
    }

    // Extract documentation (preceding comments)
    const doc = this.extractDocumentation(node, source)
    if (doc) {
      entity.documentation = doc
    }

    // Extract parent for methods
    if (entityType === 'method') {
      entity.parent = this.extractParentClass(node)
    }

    return entity
  }

  /**
   * Extract entity name based on entity type
   */
  private extractEntityName(
    node: Parser.SyntaxNode,
    _entityType: CodeEntity['type'],
  ): string | null {
    // For arrow functions assigned to variables
    if (node.type === 'arrow_function') {
      const parent = node.parent
      if (parent?.type === 'variable_declarator') {
        const nameNode = parent.childForFieldName('name')
        return nameNode?.text ?? null
      }
      // Arrow functions without name (inline) - skip
      return null
    }

    // For function/class declarations and method definitions
    const nameNode = node.childForFieldName('name')
    if (nameNode) {
      return nameNode.text
    }

    // Alternative: look for identifier child
    for (const child of node.children) {
      if (child.type === 'identifier' || child.type === 'property_identifier') {
        return child.text
      }
    }

    return null
  }

  /**
   * Extract parameters from function/method node
   */
  private extractParameters(node: Parser.SyntaxNode): string[] {
    const paramsNode = node.childForFieldName('parameters')
    if (!paramsNode)
      return []

    const params: string[] = []
    for (const child of paramsNode.children) {
      const paramName = this.extractParameterName(child)
      if (paramName) {
        params.push(paramName)
      }
    }
    return params
  }

  /**
   * Extract parameter name from a parameter node
   */
  private extractParameterName(child: Parser.SyntaxNode): string | null {
    const validTypes = ['identifier', 'required_parameter', 'optional_parameter']
    if (!validTypes.includes(child.type))
      return null

    const nameNode = child.childForFieldName('pattern') ?? child.childForFieldName('name')
    if (nameNode)
      return nameNode.text
    if (child.type === 'identifier')
      return child.text
    return null
  }

  /**
   * Extract documentation comment preceding the node
   */
  private extractDocumentation(node: Parser.SyntaxNode, _source: string): string | null {
    const prevSibling = node.previousSibling
    if (prevSibling?.type === 'comment') {
      return prevSibling.text
    }
    return null
  }

  /**
   * Extract parent class name for methods
   */
  private extractParentClass(node: Parser.SyntaxNode): string | undefined {
    let current = node.parent
    while (current) {
      if (current.type === 'class_declaration' || current.type === 'class_definition') {
        const nameNode = current.childForFieldName('name')
        return nameNode?.text
      }
      current = current.parent
    }
    return undefined
  }

  /**
   * Extract import information from an import node
   */
  private extractImport(
    node: Parser.SyntaxNode,
    _source: string,
    language: string,
  ): { module: string, names: string[] } | null {
    if (language === 'python') {
      return this.extractPythonImport(node)
    }
    return this.extractJSImport(node)
  }

  /**
   * Extract JavaScript/TypeScript import
   */
  private extractJSImport(node: Parser.SyntaxNode): { module: string, names: string[] } | null {
    const sourceNode = node.childForFieldName('source')
    if (!sourceNode)
      return null

    const module = sourceNode.text.replace(/['"]/g, '')
    const names: string[] = []

    for (const child of node.children) {
      if (child.type === 'import_clause') {
        this.extractJSImportNames(child, names)
      }
    }

    return { module, names }
  }

  /**
   * Extract names from import clause
   */
  private extractJSImportNames(clause: Parser.SyntaxNode, names: string[]): void {
    for (const child of clause.children) {
      if (child.type === 'identifier') {
        names.push(child.text)
      }
      else if (child.type === 'named_imports') {
        this.extractNamedImports(child, names)
      }
      else if (child.type === 'namespace_import') {
        this.extractNamespaceImport(child, names)
      }
    }
  }

  /**
   * Extract named imports ({ foo, bar })
   */
  private extractNamedImports(node: Parser.SyntaxNode, names: string[]): void {
    for (const importSpec of node.children) {
      if (importSpec.type === 'import_specifier') {
        const nameNode = importSpec.childForFieldName('name')
        if (nameNode) {
          names.push(nameNode.text)
        }
      }
    }
  }

  /**
   * Extract namespace import (* as name)
   */
  private extractNamespaceImport(node: Parser.SyntaxNode, names: string[]): void {
    const nameNode = node.children.find(c => c.type === 'identifier')
    if (nameNode) {
      names.push(`* as ${nameNode.text}`)
    }
  }

  /**
   * Extract Python import
   */
  private extractPythonImport(node: Parser.SyntaxNode): { module: string, names: string[] } | null {
    if (node.type === 'import_statement') {
      return this.extractPythonBasicImport(node)
    }
    if (node.type === 'import_from_statement') {
      return this.extractPythonFromImport(node)
    }
    return null
  }

  /**
   * Extract Python basic import (import os, sys)
   */
  private extractPythonBasicImport(
    node: Parser.SyntaxNode,
  ): { module: string, names: string[] } | null {
    const names: string[] = []
    let module = ''

    for (const child of node.children) {
      if (child.type === 'dotted_name') {
        names.push(child.text)
        module = module || child.text
      }
    }

    return module ? { module, names } : null
  }

  /**
   * Extract Python from import (from module import name1, name2)
   */
  private extractPythonFromImport(
    node: Parser.SyntaxNode,
  ): { module: string, names: string[] } | null {
    const moduleNode = node.childForFieldName('module_name')
    const module = moduleNode?.text ?? ''
    if (!module)
      return null

    const names: string[] = []
    for (const child of node.children) {
      if (child.type === 'dotted_name' && child !== moduleNode) {
        names.push(child.text)
      }
      else if (child.type === 'aliased_import') {
        const nameNode = child.childForFieldName('name')
        if (nameNode) {
          names.push(nameNode.text)
        }
      }
    }

    return { module, names }
  }
}
