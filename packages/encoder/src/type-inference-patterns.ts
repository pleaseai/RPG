/**
 * Per-language tree-sitter query patterns for type inference.
 *
 * Provides patterns for detecting:
 * 1. Local variable constructor assignments: `x = Foo()`, `const x = new Foo()`
 * 2. Attribute/field constructor assignments: `self.field = Bar()`, `this.field = new Bar()`
 *
 * Also exports a blocklist of common method names to reject from fuzzy global fallback.
 */

/**
 * Per-language tree-sitter query patterns and extraction helpers for type inference.
 */
export interface LanguageInferencePatterns {
  /** tree-sitter query to find local variable assignments from constructors */
  localVarAssignment: string
  /** tree-sitter query to find attribute/field assignments from constructors */
  attributeAssignment: string
  /** function to extract (varName, typeName) from a localVarAssignment match */
  extractLocalVar: (match: any) => { varName: string, typeName: string } | null
  /** function to extract (attrName, typeName) from an attributeAssignment match */
  extractAttribute: (match: any) => { attrName: string, typeName: string } | null
}

/**
 * Common helper to extract a named capture's text from a match object.
 * Supports both flat captures (name -> node) and array captures (name -> [node, ...]).
 */
function getCaptureText(match: any, captureName: string): string | null {
  const captures = match?.captures
  if (!captures)
    return null
  const node = captures[captureName]
  if (!node)
    return null
  // Support both single node and array (some query APIs return arrays)
  const text = Array.isArray(node) ? node[0]?.text : node?.text
  return typeof text === 'string' && text.length > 0 ? text : null
}

/**
 * Generic extractor for local variable assignments.
 * Reads 'var' and 'type' captures from a match.
 */
function genericExtractLocalVar(match: any): { varName: string, typeName: string } | null {
  const varName = getCaptureText(match, 'var')
  const typeName = getCaptureText(match, 'type')
  if (!varName || !typeName)
    return null
  return { varName, typeName }
}

/**
 * Generic extractor for attribute assignments.
 * Reads 'attr' and 'type' captures from a match.
 */
function genericExtractAttribute(match: any): { attrName: string, typeName: string } | null {
  const attrName = getCaptureText(match, 'attr')
  const typeName = getCaptureText(match, 'type')
  if (!attrName || !typeName)
    return null
  return { attrName, typeName }
}

/**
 * Per-language tree-sitter query patterns and extraction helpers.
 *
 * Query strings use tree-sitter s-expression syntax. Captures are named:
 *   @var   - the variable/attribute name being assigned to
 *   @type  - the constructor/type being instantiated
 *   @attr  - the attribute name in attribute assignments
 *
 * Languages: TypeScript, JavaScript, Python, Rust, Go, Java
 */
export const INFERENCE_PATTERNS: Record<string, LanguageInferencePatterns> = {
  /**
   * TypeScript: `const x = new Foo()` or `let x: Bar = new Bar()`
   * Attribute: `this.field = new Baz()`
   */
  typescript: {
    localVarAssignment: `
      (variable_declarator
        name: (identifier) @var
        value: (new_expression
          constructor: [(identifier) @type
                        (generic_type
                          type: (type_identifier) @type)]))
    `,
    attributeAssignment: `
      (assignment_expression
        left: (member_expression
          object: (this)
          property: (property_identifier) @attr)
        right: (new_expression
          constructor: [(identifier) @type
                        (generic_type
                          type: (type_identifier) @type)]))
    `,
    extractLocalVar: genericExtractLocalVar,
    extractAttribute: genericExtractAttribute,
  },

  /**
   * JavaScript: `const x = new Foo()` or `let x = new Bar()`
   * Attribute: `this.field = new Baz()`
   */
  javascript: {
    localVarAssignment: `
      (variable_declarator
        name: (identifier) @var
        value: (new_expression
          constructor: (identifier) @type))
    `,
    attributeAssignment: `
      (assignment_expression
        left: (member_expression
          object: (this)
          property: (property_identifier) @attr)
        right: (new_expression
          constructor: (identifier) @type))
    `,
    extractLocalVar: genericExtractLocalVar,
    extractAttribute: genericExtractAttribute,
  },

  /**
   * Python: `x = Foo()` (constructor call without `new`)
   * Attribute: `self.field = Bar()`
   */
  python: {
    localVarAssignment: `
      (assignment
        left: (identifier) @var
        right: (call
          function: (identifier) @type))
    `,
    attributeAssignment: `
      (assignment
        left: (attribute
          object: (identifier)
          attribute: (identifier) @attr)
        right: (call
          function: (identifier) @type))
    `,
    extractLocalVar: genericExtractLocalVar,
    extractAttribute: genericExtractAttribute,
  },

  /**
   * Java: `Foo x = new Foo()` or `Bar x = new Bar(args)`
   * Field: `this.field = new Baz()`
   */
  java: {
    localVarAssignment: `
      (local_variable_declaration
        declarator: (variable_declarator
          name: (identifier) @var
          value: (object_creation_expression
            type: (type_identifier) @type)))
    `,
    attributeAssignment: `
      (assignment_expression
        left: (field_access
          object: (this)
          field: (identifier) @attr)
        right: (object_creation_expression
          type: (type_identifier) @type))
    `,
    extractLocalVar: genericExtractLocalVar,
    extractAttribute: genericExtractAttribute,
  },

  /**
   * Rust: `let x = Foo::new()` or `let x = Foo { ... }`
   * Field: `self.field = Bar::new()`
   * Note: Rust uses Foo::new() pattern; the type is the path prefix before ::new
   */
  rust: {
    localVarAssignment: `
      (let_declaration
        pattern: (identifier) @var
        value: (call_expression
          function: (scoped_identifier
            path: (identifier) @type
            name: (identifier))))
    `,
    attributeAssignment: `
      (assignment_expression
        left: (field_expression
          value: (self)
          field: (field_identifier) @attr)
        right: (call_expression
          function: (scoped_identifier
            path: (identifier) @type
            name: (identifier))))
    `,
    extractLocalVar: genericExtractLocalVar,
    extractAttribute: genericExtractAttribute,
  },

  /**
   * Go: `x := NewFoo()` or `var x = NewFoo()`
   * Field: `s.field = NewBar()`
   * Note: Go uses constructor functions (NewFoo) rather than `new` keyword.
   */
  go: {
    localVarAssignment: `
      (short_var_declaration
        left: (expression_list
          (identifier) @var)
        right: (expression_list
          (call_expression
            function: (identifier) @type)))
    `,
    attributeAssignment: `
      (assignment_statement
        left: (expression_list
          (selector_expression
            operand: (identifier)
            field: (field_identifier) @attr))
        right: (expression_list
          (call_expression
            function: (identifier) @type)))
    `,
    extractLocalVar: genericExtractLocalVar,
    extractAttribute: genericExtractAttribute,
  },
}

/**
 * Common method names to reject during fuzzy global fallback resolution.
 *
 * When a call site's method name appears in this blocklist, the TypeInferrer
 * will not attempt fuzzy global resolution (which would match any class
 * defining a method with that name), as it is too likely to produce false
 * positives.
 */
export const COMMON_METHOD_BLOCKLIST: Set<string> = new Set([
  'get',
  'set',
  'add',
  'remove',
  'update',
  'delete',
  'create',
  'find',
  'load',
  'save',
  'init',
  'run',
  'start',
  'stop',
  'close',
  'open',
  'read',
  'write',
  'process',
  'handle',
  'execute',
  'build',
  'parse',
  'format',
  'convert',
  'check',
  'validate',
  'reset',
  'clear',
  'flush',
])
