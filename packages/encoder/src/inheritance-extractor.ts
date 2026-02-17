import type { SupportedLanguage } from '@pleaseai/rpg-utils/ast'
import type Parser from 'tree-sitter'
import type { InheritanceRelation } from './dependency-graph'
import { LANGUAGE_CONFIGS } from '@pleaseai/rpg-utils/ast'

/**
 * Extracts class inheritance and interface implementation relationships
 * from source code using tree-sitter AST parsing
 */
export class InheritanceExtractor {
  private parser: Parser | undefined

  /**
   * Get or create a Parser instance, lazy-loaded to avoid issues when tree-sitter isn't needed
   */
  private getParser(): Parser {
    if (!this.parser) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const TreeSitter = require('tree-sitter')
      this.parser = new TreeSitter() as Parser
    }
    return this.parser
  }

  /**
   * Extract inheritance and implementation relationships from source code
   */
  extract(
    source: string,
    language: string,
    filePath: string,
  ): InheritanceRelation[] {
    const normalizedLanguage = this.normalizeLanguage(language)

    if (!normalizedLanguage || !(normalizedLanguage in LANGUAGE_CONFIGS)) {
      return []
    }

    if (!source.trim()) {
      return []
    }

    try {
      const parser = this.getParser()
      const config = LANGUAGE_CONFIGS[normalizedLanguage as SupportedLanguage]
      parser.setLanguage(
        config.parser as Parameters<typeof parser.setLanguage>[0],
      )

      const tree = parser.parse(source)
      if (!tree.rootNode) {
        return []
      }

      const relations: InheritanceRelation[] = []
      this.extractFromNode(tree.rootNode, filePath, normalizedLanguage, relations)
      return relations
    }
    catch {
      return []
    }
  }

  private normalizeLanguage(language: string): string {
    const aliases: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      rs: 'rust',
      go: 'go',
      java: 'java',
    }
    return aliases[language] ?? language
  }

  private extractFromNode(
    node: Parser.SyntaxNode,
    filePath: string,
    language: string,
    relations: InheritanceRelation[],
  ): void {
    if (language === 'typescript' || language === 'javascript') {
      this.extractFromTypeScript(node, filePath, relations)
    }
    else if (language === 'python') {
      this.extractFromPython(node, filePath, relations)
    }
    else if (language === 'java') {
      this.extractFromJava(node, filePath, relations)
    }
    else if (language === 'rust') {
      this.extractFromRust(node, filePath, relations)
    }
    else if (language === 'go') {
      this.extractFromGo(node, filePath, relations)
    }

    for (const child of node.children) {
      this.extractFromNode(child, filePath, language, relations)
    }
  }

  /**
   * TypeScript/JavaScript: class_declaration → class_heritage → extends_clause / implements_clause
   */
  private extractFromTypeScript(
    node: Parser.SyntaxNode,
    filePath: string,
    relations: InheritanceRelation[],
  ): void {
    if (node.type !== 'class_declaration') {
      return
    }

    const childClass = this.getChildClassName(node)
    if (!childClass) {
      return
    }

    // Find class_heritage child which contains extends_clause and implements_clause
    const heritage = node.children.find(c => c.type === 'class_heritage')
    if (!heritage) {
      return
    }

    for (const clause of heritage.children) {
      if (clause.type === 'extends_clause') {
        // Parent class is the identifier or type_identifier within extends_clause
        for (const child of clause.children) {
          if (child.type === 'identifier' || child.type === 'type_identifier') {
            relations.push({
              childFile: filePath,
              childClass,
              parentClass: child.text,
              kind: 'inherit',
            })
          }
        }
      }
      else if (clause.type === 'implements_clause') {
        for (const child of clause.children) {
          if (child.type === 'type_identifier') {
            relations.push({
              childFile: filePath,
              childClass,
              parentClass: child.text,
              kind: 'implement',
            })
          }
        }
      }
    }
  }

  /**
   * Python: class_definition → superclasses field (argument_list) → identifier children
   */
  private extractFromPython(
    node: Parser.SyntaxNode,
    filePath: string,
    relations: InheritanceRelation[],
  ): void {
    if (node.type !== 'class_definition') {
      return
    }

    const childClass = this.getChildClassName(node)
    if (!childClass) {
      return
    }

    const argList = node.childForFieldName('superclasses')
    if (!argList) {
      return
    }

    for (const child of argList.children) {
      if (child.type === 'identifier' || child.type === 'attribute') {
        relations.push({
          childFile: filePath,
          childClass,
          parentClass: child.text,
          kind: 'inherit',
        })
      }
    }
  }

  /**
   * Java: class_declaration → superclass field (contains type_identifier), super_interfaces child
   */
  private extractFromJava(
    node: Parser.SyntaxNode,
    filePath: string,
    relations: InheritanceRelation[],
  ): void {
    if (node.type !== 'class_declaration') {
      return
    }

    const childClass = this.getChildClassName(node)
    if (!childClass) {
      return
    }

    // superclass field returns the superclass node (e.g. "extends Animal")
    // Extract type_identifier within it
    const superclass = node.childForFieldName('superclass')
    if (superclass) {
      for (const child of superclass.children) {
        if (child.type === 'type_identifier') {
          relations.push({
            childFile: filePath,
            childClass,
            parentClass: child.text,
            kind: 'inherit',
          })
        }
      }
    }

    // super_interfaces is a child node (not a field), contains type_list → type_identifier
    for (const child of node.children) {
      if (child.type === 'super_interfaces') {
        for (const listChild of child.children) {
          if (listChild.type === 'type_list') {
            for (const typeChild of listChild.children) {
              if (typeChild.type === 'type_identifier') {
                relations.push({
                  childFile: filePath,
                  childClass,
                  parentClass: typeChild.text,
                  kind: 'implement',
                })
              }
            }
          }
        }
      }
    }
  }

  /**
   * Rust: impl_item → trait field + type field
   */
  private extractFromRust(
    node: Parser.SyntaxNode,
    filePath: string,
    relations: InheritanceRelation[],
  ): void {
    if (node.type !== 'impl_item') {
      return
    }

    const traitNode = node.childForFieldName('trait')
    const typeNode = node.childForFieldName('type')

    if (!traitNode || !typeNode) {
      return
    }

    relations.push({
      childFile: filePath,
      childClass: typeNode.text,
      parentClass: traitNode.text,
      kind: 'implement',
    })
  }

  /**
   * Go: type_declaration → type_spec child → struct_type → embedded field_declarations
   */
  private extractFromGo(
    node: Parser.SyntaxNode,
    filePath: string,
    relations: InheritanceRelation[],
  ): void {
    if (node.type !== 'type_declaration') {
      return
    }

    // type_spec is a child by type, not a field
    const typeSpec = node.children.find(c => c.type === 'type_spec')
    if (!typeSpec) {
      return
    }

    const childClass = typeSpec.childForFieldName('name')?.text
    if (!childClass) {
      return
    }

    const structType = typeSpec.childForFieldName('type')
    if (!structType || structType.type !== 'struct_type') {
      return
    }

    // Look for embedded structs (field declarations without name field)
    for (const child of structType.children) {
      if (child.type === 'field_declaration_list') {
        for (const fieldChild of child.children) {
          if (fieldChild.type === 'field_declaration') {
            const name = fieldChild.childForFieldName('name')
            if (!name) {
              const type = fieldChild.childForFieldName('type')
              if (type) {
                relations.push({
                  childFile: filePath,
                  childClass,
                  parentClass: type.text,
                  kind: 'inherit',
                })
              }
            }
          }
        }
        break
      }
    }
  }

  private getChildClassName(node: Parser.SyntaxNode): string | null {
    const nameNode = node.childForFieldName('name')
    if (nameNode) {
      return nameNode.text
    }

    for (const child of node.children) {
      if (child.type === 'type_identifier' || child.type === 'identifier') {
        return child.text
      }
    }

    return null
  }
}
