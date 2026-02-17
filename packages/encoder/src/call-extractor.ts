import type { SupportedLanguage } from '@pleaseai/rpg-utils/ast'
import type Parser from 'tree-sitter'
import type { CallSite } from './dependency-graph'
import { LANGUAGE_CONFIGS } from '@pleaseai/rpg-utils/ast'

/**
 * Extracts function/method call sites from source code using tree-sitter AST parsing.
 *
 * Handles different call patterns per language:
 * - Direct function calls: `foo()` → calleeSymbol: `foo`
 * - Method calls: `obj.method()` → calleeSymbol: `method`
 * - `this.method()` → calleeSymbol: `method`, callerEntity tracks context
 * - `super.method()` → calleeSymbol: `method` (parent-reference)
 * - Constructor calls: `new Foo()` → calleeSymbol: `Foo`
 * - Chained calls: `a.b.c()` → calleeSymbol: `c`
 */
export class CallExtractor {
  private readonly parser: Parser

  constructor() {
    // Dynamically import tree-sitter to avoid hard dependency
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const TreeSitter = require('tree-sitter')
    this.parser = new TreeSitter()
  }

  /**
   * Check if a language is supported
   */
  private isSupportedLanguage(language: string): language is SupportedLanguage {
    return language in LANGUAGE_CONFIGS && LANGUAGE_CONFIGS[language as SupportedLanguage] !== undefined
  }

  /**
   * Extract all call sites from source code
   */
  extract(source: string, language: string, filePath: string): CallSite[] {
    const calls: CallSite[] = []

    // Handle empty source
    if (!source.trim()) {
      return calls
    }

    // Check if language is supported
    if (!this.isSupportedLanguage(language)) {
      return calls
    }

    const config = LANGUAGE_CONFIGS[language]

    try {
      // Set language parser
      this.parser.setLanguage(
        config.parser as Parameters<typeof this.parser.setLanguage>[0],
      )

      // Parse the source
      const tree = this.parser.parse(source)

      if (!tree.rootNode) {
        return calls
      }

      // Extract all calls from the tree
      this.extractCallsFromNode(tree.rootNode, filePath, language, calls)
    }
    catch {
      // Silently handle parse errors
      return calls
    }

    return calls
  }

  /**
   * Recursively extract calls from AST node
   */
  private extractCallsFromNode(
    node: Parser.SyntaxNode,
    filePath: string,
    language: string,
    calls: CallSite[],
    currentContext?: string,
  ): void {
    // Extract calls based on node type
    this.extractCallsFromNodeType(node, filePath, language, calls, currentContext)

    // Update context for nested calls
    const contextUpdate = this.updateContextForNode(node, currentContext)

    // Recurse into children
    for (const child of node.children) {
      this.extractCallsFromNode(child, filePath, language, calls, contextUpdate)
    }
  }

  /**
   * Extract calls from a specific node type (call_expression, new_expression)
   */
  private extractCallsFromNodeType(
    node: Parser.SyntaxNode,
    filePath: string,
    language: string,
    calls: CallSite[],
    currentContext?: string,
  ): void {
    // Only handle TypeScript/JavaScript for now
    if (language !== 'typescript' && language !== 'javascript') {
      return
    }

    if (node.type === 'call_expression') {
      this.extractCallExpressionTS(node, filePath, calls, currentContext)
    }
    else if (node.type === 'new_expression') {
      this.extractNewExpression(node, filePath, calls, currentContext)
    }
  }

  /**
   * Update the context path when entering a class or function definition
   */
  private updateContextForNode(node: Parser.SyntaxNode, currentContext?: string): string | undefined {
    const isClassNode = node.type === 'class_declaration' || node.type === 'class_definition'
    const isFunctionNode = node.type === 'function_declaration' || node.type === 'method_definition'
    const isArrowFunctionNode = node.type === 'arrow_function'

    if (isClassNode || isFunctionNode) {
      const nameNode = node.childForFieldName('name')
      if (!nameNode) {
        return currentContext
      }
      return currentContext ? `${currentContext}.${nameNode.text}` : nameNode.text
    }

    if (isArrowFunctionNode) {
      return this.extractArrowFunctionName(node, currentContext)
    }

    return currentContext
  }

  /**
   * Extract the name of an arrow function from its variable declarator
   */
  private extractArrowFunctionName(node: Parser.SyntaxNode, currentContext?: string): string | undefined {
    const parent = node.parent
    if (parent?.type !== 'variable_declarator') {
      return currentContext
    }

    const nameNode = parent.childForFieldName('name')
    if (!nameNode) {
      return currentContext
    }

    return currentContext ? `${currentContext}.${nameNode.text}` : nameNode.text
  }

  /**
   * Extract call information from a call_expression node (TypeScript/JavaScript)
   */
  private extractCallExpressionTS(
    node: Parser.SyntaxNode,
    filePath: string,
    calls: CallSite[],
    currentContext?: string,
  ): void {
    // Get the function field (what's being called)
    const functionNode = node.childForFieldName('function')
    if (!functionNode) {
      return
    }

    const callSite = this.extractCallSymbol(functionNode, filePath, currentContext)
    if (callSite) {
      // Get line number (1-indexed)
      callSite.line = node.startPosition.row + 1
      calls.push(callSite)
    }
  }

  /**
   * Extract call information from a new_expression node (TypeScript/JavaScript)
   */
  private extractNewExpression(
    node: Parser.SyntaxNode,
    filePath: string,
    calls: CallSite[],
    currentContext?: string,
  ): void {
    // Get the constructor being called
    const constructorNode = node.childForFieldName('constructor')
    if (!constructorNode) {
      return
    }

    const callSite = this.extractCallSymbol(constructorNode, filePath, currentContext)
    if (callSite) {
      // Get line number (1-indexed)
      callSite.line = node.startPosition.row + 1
      calls.push(callSite)
    }
  }

  /**
   * Extract the symbol being called from a function node
   */
  private extractCallSymbol(
    node: Parser.SyntaxNode,
    filePath: string,
    currentContext?: string,
  ): CallSite | null {
    const symbol = this.extractSymbolFromNode(node)
    if (!symbol) {
      return null
    }

    return {
      calleeSymbol: symbol,
      callerFile: filePath,
      callerEntity: currentContext,
    }
  }

  /**
   * Extract the symbol name from a node
   */
  private extractSymbolFromNode(node: Parser.SyntaxNode): string | null {
    // Handle member_expression (obj.method or a.b.c)
    if (node.type === 'member_expression') {
      return this.extractMemberExpressionSymbol(node)
    }

    // Handle identifier (direct function call)
    if (node.type === 'identifier') {
      return node.text
    }

    // Handle generic_type (e.g., Array<number> in new Array<number>())
    if (node.type === 'generic_type') {
      return this.extractGenericTypeSymbol(node)
    }

    return null
  }

  /**
   * Extract symbol from a member_expression (e.g., obj.method)
   */
  private extractMemberExpressionSymbol(node: Parser.SyntaxNode): string | null {
    const propertyNode = node.childForFieldName('property')
    if (!propertyNode) {
      return null
    }

    let symbol = propertyNode.text
    // Remove optional chaining operator if present
    if (symbol.startsWith('?.')) {
      symbol = symbol.slice(2)
    }

    return symbol
  }

  /**
   * Extract symbol from a generic_type (e.g., Array in Array<number>)
   */
  private extractGenericTypeSymbol(node: Parser.SyntaxNode): string | null {
    const typeNode = node.childForFieldName('type') ?? node.children[0]
    if (typeNode?.type === 'identifier') {
      return typeNode.text
    }
    return null
  }
}
