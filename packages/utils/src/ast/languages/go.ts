import type { CodeEntity, LanguageConfig } from '../types'

const Go = require('tree-sitter-go')

const GO_ENTITY_TYPES: Record<string, CodeEntity['type']> = {
  function_declaration: 'function',
  method_declaration: 'method',
  type_spec: 'class',
}

const GO_IMPORT_TYPES = ['import_spec']

export const goConfig: LanguageConfig = {
  parser: Go,
  entityTypes: GO_ENTITY_TYPES,
  importTypes: GO_IMPORT_TYPES,
}
