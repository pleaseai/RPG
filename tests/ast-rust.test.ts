import { ASTParser } from '@pleaseai/rpg-utils/ast'
import { beforeEach, describe, expect, it } from 'vitest'

describe('ASTParser - Rust', () => {
  let parser: ASTParser

  beforeEach(() => {
    parser = new ASTParser()
  })

  it('supports rust language', () => {
    expect(parser.isLanguageSupported('rust')).toBe(true)
  })

  describe('parse - Rust entities', () => {
    it('extracts function_item', async () => {
      const source = `fn greet(name: &str) -> String {
    format!("Hello, {}", name)
}`
      const result = await parser.parse(source, 'rust')

      expect(result.entities).toHaveLength(1)
      expect(result.entities[0]).toMatchObject({
        type: 'function',
        name: 'greet',
        startLine: 1,
        endLine: 3,
      })
    })

    it('extracts struct_item', async () => {
      const source = `struct User {
    name: String,
    age: u32,
}`
      const result = await parser.parse(source, 'rust')

      expect(result.entities).toHaveLength(1)
      expect(result.entities[0]).toMatchObject({
        type: 'class',
        name: 'User',
      })
    })

    it('extracts impl_item', async () => {
      const source = `impl User {
    fn new(name: String) -> Self {
        User { name }
    }
}`
      const result = await parser.parse(source, 'rust')

      const implEntity = result.entities.find(e => e.name === 'User' && e.type === 'class')
      expect(implEntity).toBeDefined()
      const fnEntity = result.entities.find(e => e.name === 'new')
      expect(fnEntity).toBeDefined()
      expect(fnEntity!.type).toBe('function')
    })

    it('extracts trait_item', async () => {
      const source = `trait Greetable {
    fn greet(&self) -> String;
}`
      const result = await parser.parse(source, 'rust')

      const traitEntity = result.entities.find(e => e.name === 'Greetable')
      expect(traitEntity).toBeDefined()
      expect(traitEntity!.type).toBe('class')
    })

    it('extracts enum_item', async () => {
      const source = `enum Color {
    Red,
    Green,
    Blue,
}`
      const result = await parser.parse(source, 'rust')

      const enumEntity = result.entities.find(e => e.name === 'Color')
      expect(enumEntity).toBeDefined()
      expect(enumEntity!.type).toBe('class')
    })
  })

  describe('parse - Rust imports', () => {
    it('extracts simple use declaration', async () => {
      const source = `use std::collections::HashMap;`
      const result = await parser.parse(source, 'rust')

      expect(result.imports).toHaveLength(1)
      expect(result.imports[0].module).toBe('std::collections::HashMap')
    })

    it('extracts crate use declaration', async () => {
      const source = `use crate::module::MyStruct;`
      const result = await parser.parse(source, 'rust')

      expect(result.imports).toHaveLength(1)
      expect(result.imports[0].module).toBe('crate::module::MyStruct')
    })

    it('extracts wildcard use', async () => {
      const source = `use std::io::*;`
      const result = await parser.parse(source, 'rust')

      expect(result.imports).toHaveLength(1)
      expect(result.imports[0].module).toContain('std::io')
    })

    it('extracts grouped use declaration', async () => {
      const source = `use std::collections::{HashMap, BTreeMap};`
      const result = await parser.parse(source, 'rust')

      expect(result.imports).toHaveLength(1)
      expect(result.imports[0].module).toBe('std::collections::{HashMap, BTreeMap}')
    })

    it('handles empty source', async () => {
      const result = await parser.parse('', 'rust')
      expect(result.entities).toEqual([])
      expect(result.imports).toEqual([])
      expect(result.errors).toEqual([])
    })
  })
})
