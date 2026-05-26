import type { NamuNode, NamuParser } from '@pleaseai/soop-namu'
import type { CodeEntity, LanguageConfig, ParseResult } from './types'

import { createParser, getLanguage, isAvailable as namuIsAvailable } from '@pleaseai/soop-namu'
import { isSupportedLanguage, LANGUAGE_CONFIGS } from './languages'

/**
 * AST Parser using native tree-sitter grammars via @pleaseai/soop-namu.
 *
 * Extracts code structure for dependency analysis and semantic lifting.
 * Grammars ship as prebuilt NAPI binaries (@kreuzberg/tree-sitter-language-pack)
 * — no emcc/Docker build required.
 */
export class ASTParser {
  private parserPromises = new Map<string, Promise<NamuParser>>()

  /**
   * Check if WASM tree-sitter is available.
   * Always returns true — WASM has no native compilation requirements.
   */
  isAvailable(): boolean {
    return namuIsAvailable()
  }

  /**
   * Check if a language is supported
   */
  isLanguageSupported(language: string): boolean {
    return isSupportedLanguage(language)
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
      cs: 'csharp',
      c: 'c',
      h: 'c',
      cpp: 'cpp',
      cc: 'cpp',
      cxx: 'cpp',
      hpp: 'cpp',
      hxx: 'cpp',
      rb: 'ruby',
      kt: 'kotlin',
      kts: 'kotlin',
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
    if (!isSupportedLanguage(language)) {
      result.errors.push(`Unsupported language: ${language}`)
      return result
    }
    const config = LANGUAGE_CONFIGS[language]!

    try {
      let parserPromise = this.parserPromises.get(language)
      if (!parserPromise) {
        parserPromise = (async () => {
          const p = await createParser()
          const lang = await getLanguage(language as Parameters<typeof getLanguage>[0])
          p.setLanguage(lang)
          return p
        })()
        parserPromise = parserPromise.catch((error) => {
          this.parserPromises.delete(language)
          throw error
        })
        this.parserPromises.set(language, parserPromise)
      }
      const parser = await parserPromise

      // Parse the source
      const tree = parser.parse(source)

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
    node: NamuNode,
    source: string,
    config: LanguageConfig,
    result: ParseResult,
  ): void {
    const nodeType = node.type

    // Check if this is an entity node
    const entityType = config.entityTypes[nodeType]
    if (entityType) {
      const entity = this.extractEntity(node, entityType)
      if (entity) {
        result.entities.push(entity)
      }
    }

    // Check if this is an import node
    if (config.importTypes.includes(nodeType)) {
      const importInfo = this.extractImport(node, result.language)
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
    node: NamuNode,
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
    const doc = this.extractDocumentation(node)
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
    node: NamuNode,
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

    // For Rust impl_item - name is in the 'type' field
    if (node.type === 'impl_item') {
      const typeNode = node.childForFieldName('type')
      return typeNode?.text ?? null
    }

    // For C function_definition - name is nested inside declarator chain
    if (node.type === 'function_definition') {
      const declarator = node.childForFieldName('declarator')
      if (declarator) {
        return this.extractCDeclaratorName(declarator)
      }
    }

    // For function/class declarations and method definitions
    const nameNode = node.childForFieldName('name')
    if (nameNode) {
      return nameNode.text
    }

    // Alternative: look for identifier / type_identifier / simple_identifier child
    // (type_identifier and simple_identifier are used by Kotlin, C++, etc.)
    for (const child of node.children) {
      if (
        child.type === 'identifier'
        || child.type === 'property_identifier'
        || child.type === 'type_identifier'
        || child.type === 'simple_identifier'
      ) {
        return child.text
      }
    }

    return null
  }

  /**
   * Recursively extract function name from C/C++ declarator chain.
   * function_definition.declarator can be:
   *   - function_declarator → declarator (identifier or pointer_declarator → ...)
   *   - pointer_declarator → declarator → ...
   */
  private extractCDeclaratorName(node: NamuNode): string | null {
    if (node.type === 'identifier') {
      return node.text
    }
    // function_declarator has a 'declarator' field
    const inner = node.childForFieldName('declarator')
    if (inner) {
      return this.extractCDeclaratorName(inner)
    }
    // fallback: look for identifier child
    for (const child of node.children) {
      if (child.type === 'identifier') {
        return child.text
      }
    }
    return null
  }

  /**
   * Extract parameters from function/method node
   */
  private extractParameters(node: NamuNode): string[] {
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
  private extractParameterName(child: NamuNode): string | null {
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
  private extractDocumentation(node: NamuNode): string | null {
    const prevSibling = node.previousSibling
    if (prevSibling?.type === 'comment') {
      return prevSibling.text
    }
    return null
  }

  /**
   * Extract parent class name for methods
   */
  private extractParentClass(node: NamuNode): string | undefined {
    // For Go methods, extract receiver type
    if (node.type === 'method_declaration') {
      return this.extractGoReceiverType(node)
    }

    let current = node.parent
    while (current) {
      if (
        current.type === 'class_declaration'
        || current.type === 'class_definition'
        || current.type === 'impl_item'
        || current.type === 'class_specifier'
        || current.type === 'struct_declaration'
        || current.type === 'class'
        || current.type === 'module'
        || current.type === 'object_declaration'
      ) {
        const nameNode = current.childForFieldName('name') ?? current.childForFieldName('type')
        return nameNode?.text
      }
      current = current.parent
    }
    return undefined
  }

  /**
   * Extract Go method receiver type (e.g., *User -> User)
   */
  private extractGoReceiverType(node: NamuNode): string | undefined {
    const receiver = node.childForFieldName('receiver')
    if (!receiver)
      return undefined

    for (const child of receiver.children) {
      if (child.type === 'parameter_declaration') {
        const typeNode = child.childForFieldName('type')
        if (typeNode) {
          return typeNode.text.replace(/^\*/, '')
        }
      }
    }
    return undefined
  }

  /**
   * Extract import information from an import node
   */
  private extractImport(
    node: NamuNode,
    language: string,
  ): { module: string, names: string[] } | null {
    if (language === 'python') {
      return this.extractPythonImport(node)
    }
    if (language === 'rust') {
      return this.extractRustImport(node)
    }
    if (language === 'go') {
      return this.extractGoImport(node)
    }
    if (language === 'java') {
      return this.extractJavaImport(node)
    }
    if (language === 'csharp') {
      return this.extractCSharpImport(node)
    }
    if (language === 'c' || language === 'cpp') {
      return this.extractCCppImport(node)
    }
    if (language === 'ruby') {
      return this.extractRubyImport(node)
    }
    if (language === 'kotlin') {
      return this.extractKotlinImport(node)
    }
    return this.extractJSImport(node)
  }

  /**
   * Extract JavaScript/TypeScript import
   */
  private extractJSImport(node: NamuNode): { module: string, names: string[] } | null {
    const sourceNode = node.childForFieldName('source')
    if (!sourceNode)
      return null

    const module = sourceNode.text.replaceAll('\'', '').replaceAll('"', '')
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
  private extractJSImportNames(clause: NamuNode, names: string[]): void {
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
  private extractNamedImports(node: NamuNode, names: string[]): void {
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
  private extractNamespaceImport(node: NamuNode, names: string[]): void {
    const nameNode = node.children.find(c => c.type === 'identifier')
    if (nameNode) {
      names.push(`* as ${nameNode.text}`)
    }
  }

  /**
   * Extract Python import
   */
  private extractPythonImport(node: NamuNode): { module: string, names: string[] } | null {
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
    node: NamuNode,
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
    node: NamuNode,
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

  /**
   * Extract Rust use declaration
   */
  private extractRustImport(node: NamuNode): { module: string, names: string[] } | null {
    if (node.type !== 'use_declaration')
      return null

    // Get the full use path text, removing 'use' keyword and trailing semicolon
    const text = node.text.replace(/^use\s+/, '').replace(/;$/, '').trim()
    return { module: text, names: [] }
  }

  /**
   * Extract Go import spec
   */
  private extractGoImport(node: NamuNode): { module: string, names: string[] } | null {
    // Handle individual import_spec (both single and grouped imports recurse to this)
    if (node.type === 'import_spec') {
      const pathNode = node.childForFieldName('path')
      if (pathNode) {
        return { module: pathNode.text.replaceAll('"', ''), names: [] }
      }
      return null
    }

    // import_declaration without import_spec_list (skip, handled by recursion)
    return null
  }

  /**
   * Extract C# using directive (e.g. using System.IO; using static Foo; using Alias = Bar;)
   */
  private extractCSharpImport(node: NamuNode): { module: string, names: string[] } | null {
    if (node.type !== 'using_directive')
      return null

    // Strip 'using', optional 'static', optional 'alias =', and trailing semicolon
    const text = node.text
      .replace(/^using\s+/, '')
      .replace(/^static\s+/, '')
      .replace(/;$/, '')
      .replace(/^\w+\s*=\s*/, '') // strip alias
      .trim()

    return text ? { module: text, names: [] } : null
  }

  /**
   * Extract C/C++ #include directive (e.g. #include <stdio.h> or #include "myheader.h")
   */
  private extractCCppImport(node: NamuNode): { module: string, names: string[] } | null {
    if (node.type !== 'preproc_include')
      return null

    const pathNode = node.childForFieldName('path')
    if (!pathNode)
      return null

    // Strip surrounding quotes or angle brackets using slice
    const text = pathNode.text
    const module = text.length >= 2 ? text.slice(1, -1) : text
    return module ? { module, names: [] } : null
  }

  /**
   * Extract Ruby require/require_relative calls
   * Only 'call' nodes whose function is 'require' or 'require_relative' are included.
   */
  private extractRubyImport(node: NamuNode): { module: string, names: string[] } | null {
    if (node.type !== 'call')
      return null

    const methodNode = node.childForFieldName('method')
    if (!methodNode)
      return null

    const methodName = methodNode.text
    if (methodName !== 'require' && methodName !== 'require_relative')
      return null

    // Arguments are in the 'arguments' field; find the string argument
    const argsNode = node.childForFieldName('arguments')
    if (!argsNode)
      return null

    const stringArg = argsNode.children.find(child => child.type === 'string')
    if (stringArg && stringArg.text.length > 1) {
      // string node text includes quotes, so we slice them.
      const raw = stringArg.text.slice(1, -1)
      if (raw) {
        return { module: raw, names: [] }
      }
    }

    return null
  }

  /**
   * Extract Kotlin import header (e.g. import com.example.Foo)
   */
  private extractKotlinImport(node: NamuNode): { module: string, names: string[] } | null {
    if (node.type !== 'import_header')
      return null

    const text = node.text
      .replace(/^import\s+/, '')
      .replace(/\.\*$/, '')
      .replace(/\s+as\s+`?[\w$]+`?$/, '')
      .trim()

    return text ? { module: text, names: [] } : null
  }

  /**
   * Extract Java import declaration
   */
  private extractJavaImport(node: NamuNode): { module: string, names: string[] } | null {
    if (node.type !== 'import_declaration')
      return null

    // Remove 'import', optional 'static', and trailing semicolon
    const text = node.text
      .replace(/^import\s+/, '')
      .replace(/^static\s+/, '')
      .replace(/;$/, '')
      .trim()

    return { module: text, names: [] }
  }
}
