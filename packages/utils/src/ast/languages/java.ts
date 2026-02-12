import type { CodeEntity, LanguageConfig } from '../types'

const Java = require('tree-sitter-java')

const JAVA_ENTITY_TYPES: Record<string, CodeEntity['type']> = {
  method_declaration: 'method',
  class_declaration: 'class',
  interface_declaration: 'class',
  enum_declaration: 'class',
  constructor_declaration: 'method',
}

const JAVA_IMPORT_TYPES = ['import_declaration']

export const javaConfig: LanguageConfig = {
  parser: Java,
  entityTypes: JAVA_ENTITY_TYPES,
  importTypes: JAVA_IMPORT_TYPES,
}
