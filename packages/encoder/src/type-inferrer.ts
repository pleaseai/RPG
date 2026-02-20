import type { SupportedLanguage } from '@pleaseai/rpg-utils/ast'
import type Parser from 'tree-sitter'
import type { CallSite, EntityNode, InheritanceRelation } from './dependency-graph'
import { LANGUAGE_CONFIGS } from '@pleaseai/rpg-utils/ast'
import { COMMON_METHOD_BLOCKLIST, INFERENCE_PATTERNS } from './type-inference-patterns'

/**
 * TypeInferrer resolves receiver types in CallSite objects to produce
 * qualified call names (e.g. "ClassName.methodName").
 *
 * It builds in-memory indices from EntityNode[] and InheritanceRelation[],
 * supports depth-first MRO traversal with cycle detection, and falls back
 * to fuzzy global matching for unresolved receivers (rejecting common names).
 */
export class TypeInferrer {
  private readonly classIndex: Map<string, EntityNode>
  private readonly parentIndex: Map<string, string[]>
  private readonly methodIndex: Map<string, string[]>
  private parser: Parser | undefined

  constructor(entities: EntityNode[], inheritances: InheritanceRelation[]) {
    this.classIndex = new Map()
    this.parentIndex = new Map()
    this.methodIndex = new Map()
    this.buildIndices(entities, inheritances)
  }

  private buildIndices(entities: EntityNode[], inheritances: InheritanceRelation[]): void {
    for (const entity of entities) {
      this.classIndex.set(entity.className, entity)
      for (const method of entity.methods) {
        const classes = this.methodIndex.get(method) ?? []
        classes.push(entity.className)
        this.methodIndex.set(method, classes)
      }
    }

    for (const rel of inheritances) {
      const parents = this.parentIndex.get(rel.childClass) ?? []
      parents.push(rel.parentClass)
      this.parentIndex.set(rel.childClass, parents)
    }
  }

  /**
   * Depth-first MRO chain starting from className (includes itself).
   * Handles cycles via visited set.
   */
  getMROChain(className: string): string[] {
    const chain: string[] = []
    const visited = new Set<string>()
    this.dfs(className, chain, visited)
    return chain
  }

  private dfs(className: string, chain: string[], visited: Set<string>): void {
    if (visited.has(className))
      return
    visited.add(className)
    chain.push(className)
    for (const parent of this.parentIndex.get(className) ?? []) {
      this.dfs(parent, chain, visited)
    }
  }

  /**
   * Infer the type of a local variable from constructor assignments in source code.
   * e.g. `x = Foo()` → 'Foo', `const x = new Bar()` → 'Bar'
   */
  inferLocalVarType(source: string, language: string, varName: string): string | null {
    if (!INFERENCE_PATTERNS[language])
      return null
    const parser = this.getParser(language)
    if (!parser)
      return null
    try {
      const tree = parser.parse(source)
      return this.findLocalVarType(tree.rootNode, language, varName)
    }
    catch {
      return null
    }
  }

  private findLocalVarType(node: Parser.SyntaxNode, language: string, varName: string): string | null {
    // Python: x = Foo()
    if (language === 'python' && node.type === 'assignment') {
      const left = node.childForFieldName('left')
      const right = node.childForFieldName('right')
      if (left?.text === varName && right?.type === 'call') {
        const fn = right.childForFieldName('function')
        if (fn?.type === 'identifier')
          return fn.text
      }
    }

    // TypeScript / JavaScript: const x = new Foo() or let x = new Foo()
    if ((language === 'typescript' || language === 'javascript') && node.type === 'variable_declarator') {
      const nameNode = node.childForFieldName('name')
      const valueNode = node.childForFieldName('value')
      if (nameNode?.text === varName && valueNode?.type === 'new_expression') {
        const ctor = valueNode.childForFieldName('constructor')
        if (ctor)
          return ctor.text
      }
    }

    // Java: Foo x = new Foo()
    if (language === 'java' && node.type === 'local_variable_declaration') {
      for (const child of node.children) {
        if (child.type === 'variable_declarator') {
          const nameNode = child.childForFieldName('name')
          const valueNode = child.childForFieldName('value')
          if (nameNode?.text === varName && valueNode?.type === 'object_creation_expression') {
            const type = valueNode.childForFieldName('type')
            if (type)
              return type.text
          }
        }
      }
    }

    for (const child of node.children) {
      const result = this.findLocalVarType(child, language, varName)
      if (result)
        return result
    }
    return null
  }

  /**
   * Infer the type of an instance attribute from constructor assignments.
   * e.g. `self.field = Bar()` → 'Bar', `this.field = new Bar()` → 'Bar'
   */
  inferAttributeType(source: string, language: string, attrName: string): string | null {
    if (!INFERENCE_PATTERNS[language])
      return null
    const parser = this.getParser(language)
    if (!parser)
      return null
    try {
      const tree = parser.parse(source)
      return this.findAttributeType(tree.rootNode, language, attrName)
    }
    catch {
      return null
    }
  }

  private findAttributeType(node: Parser.SyntaxNode, language: string, attrName: string): string | null {
    // Python: self.field = Bar()
    if (language === 'python' && node.type === 'assignment') {
      const left = node.childForFieldName('left')
      const right = node.childForFieldName('right')
      if (left?.type === 'attribute' && right?.type === 'call') {
        const obj = left.childForFieldName('object')
        const attr = left.childForFieldName('attribute')
        if (obj?.text === 'self' && attr?.text === attrName) {
          const fn = right.childForFieldName('function')
          if (fn?.type === 'identifier')
            return fn.text
        }
      }
    }

    // TypeScript / JavaScript: this.field = new Bar()
    if ((language === 'typescript' || language === 'javascript') && node.type === 'assignment_expression') {
      const left = node.childForFieldName('left')
      const right = node.childForFieldName('right')
      if (left?.type === 'member_expression' && right?.type === 'new_expression') {
        const obj = left.childForFieldName('object')
        const prop = left.childForFieldName('property')
        if (obj?.type === 'this' && prop?.text === attrName) {
          const ctor = right.childForFieldName('constructor')
          if (ctor)
            return ctor.text
        }
      }
    }

    for (const child of node.children) {
      const result = this.findAttributeType(child, language, attrName)
      if (result)
        return result
    }
    return null
  }

  /**
   * Resolve a CallSite with receiver info to a qualified name ("ClassName.methodName").
   * Returns null if resolution fails.
   *
   * Resolution order:
   * 1. self/this → look up callerEntity class, walk MRO
   * 2. super → skip current class, walk MRO from index 1
   * 3. variable → infer type via constructor assignment, then walk MRO
   * 4. Fuzzy global fallback (rejects common names + ambiguous matches)
   */
  resolveQualifiedCall(callSite: CallSite, source: string, language: string): string | null {
    const { receiverKind, calleeSymbol, callerEntity, receiver } = callSite

    if (!receiverKind || receiverKind === 'none')
      return null

    if (receiverKind === 'self' || receiverKind === 'super') {
      const className = callerEntity?.split('.')[0]
      if (!className)
        return null
      const mro = this.getMROChain(className)
      const startIdx = receiverKind === 'super' ? 1 : 0
      for (let i = startIdx; i < mro.length; i++) {
        const entity = this.classIndex.get(mro[i])
        if (entity?.methods.includes(calleeSymbol)) {
          return `${mro[i]}.${calleeSymbol}`
        }
      }
      return null
    }

    if (receiverKind === 'variable') {
      if (receiver) {
        const typeName = this.inferLocalVarType(source, language, receiver)
        if (typeName) {
          const mro = this.getMROChain(typeName)
          for (const cls of mro) {
            const entity = this.classIndex.get(cls)
            if (entity?.methods.includes(calleeSymbol)) {
              return `${cls}.${calleeSymbol}`
            }
          }
          return null
        }
      }
      // Fuzzy fallback
      return this.fuzzyFallback(calleeSymbol)
    }

    return null
  }

  private fuzzyFallback(methodName: string): string | null {
    if (COMMON_METHOD_BLOCKLIST.has(methodName))
      return null
    const classes = this.methodIndex.get(methodName)
    if (!classes || classes.length !== 1)
      return null
    return `${classes[0]}.${methodName}`
  }

  private getParser(language: string): Parser | null {
    if (!this.isSupportedLanguage(language))
      return null
    if (!this.parser) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const TreeSitter = require('tree-sitter')
      this.parser = new TreeSitter() as Parser
    }
    const config = LANGUAGE_CONFIGS[language]
    try {
      this.parser.setLanguage(config.parser as Parameters<typeof this.parser.setLanguage>[0])
      return this.parser
    }
    catch {
      return null
    }
  }

  private isSupportedLanguage(language: string): language is SupportedLanguage {
    return language in LANGUAGE_CONFIGS && LANGUAGE_CONFIGS[language as SupportedLanguage] !== undefined
  }
}
