import type { CodeEntity, LanguageConfig } from '../types'

// Tree-sitter language parser
const Python = require('tree-sitter-python')

/**
 * Entity node types for Python
 */
const PYTHON_ENTITY_TYPES: Record<string, CodeEntity['type']> = {
  function_definition: 'function',
  async_function_definition: 'function',
  class_definition: 'class',
}

/**
 * Import node types for Python
 */
const PYTHON_IMPORT_TYPES = ['import_statement', 'import_from_statement']

/**
 * Language configuration for Python
 */
export const pythonConfig: LanguageConfig = {
  parser: Python,
  entityTypes: PYTHON_ENTITY_TYPES,
  importTypes: PYTHON_IMPORT_TYPES,
}
