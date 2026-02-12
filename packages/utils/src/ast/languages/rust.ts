import type { CodeEntity, LanguageConfig } from '../types'

const Rust = require('tree-sitter-rust')

const RUST_ENTITY_TYPES: Record<string, CodeEntity['type']> = {
  function_item: 'function',
  struct_item: 'class',
  impl_item: 'class',
  trait_item: 'class',
  enum_item: 'class',
  mod_item: 'class',
}

const RUST_IMPORT_TYPES = ['use_declaration']

export const rustConfig: LanguageConfig = {
  parser: Rust,
  entityTypes: RUST_ENTITY_TYPES,
  importTypes: RUST_IMPORT_TYPES,
}
