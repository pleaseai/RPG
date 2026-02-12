import type { CodeEntity, LanguageConfig } from '../types'

// Tree-sitter language parser
const TypeScript = require('tree-sitter-typescript').typescript

/**
 * Entity node types for TypeScript and JavaScript
 */
const TS_JS_ENTITY_TYPES: Record<string, CodeEntity['type']> = {
  function_declaration: 'function',
  arrow_function: 'function',
  class_declaration: 'class',
  method_definition: 'method',
}

/**
 * Import node types for TypeScript and JavaScript
 */
const TYPESCRIPT_IMPORT_TYPES = ['import_statement']

/**
 * Language configuration for TypeScript
 */
export const typescriptConfig: LanguageConfig = {
  parser: TypeScript,
  entityTypes: TS_JS_ENTITY_TYPES,
  importTypes: TYPESCRIPT_IMPORT_TYPES,
}

/**
 * Language configuration for JavaScript
 * Uses the same TypeScript parser as JavaScript is a subset of TypeScript
 */
export const javascriptConfig: LanguageConfig = {
  parser: TypeScript,
  entityTypes: TS_JS_ENTITY_TYPES,
  importTypes: TYPESCRIPT_IMPORT_TYPES,
}
