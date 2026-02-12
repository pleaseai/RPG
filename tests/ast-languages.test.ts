import type { LanguageConfig } from '@pleaseai/rpg-utils/ast/types'
import { LANGUAGE_CONFIGS } from '@pleaseai/rpg-utils/ast/languages'
import { describe, expect, it } from 'vitest'

describe('Language Configurations', () => {
  describe('LANGUAGE_CONFIGS', () => {
    it('has typescript configuration', () => {
      expect(LANGUAGE_CONFIGS.typescript).toBeDefined()
    })

    it('has javascript configuration', () => {
      expect(LANGUAGE_CONFIGS.javascript).toBeDefined()
    })

    it('has python configuration', () => {
      expect(LANGUAGE_CONFIGS.python).toBeDefined()
    })

    it('has rust configuration', () => {
      expect(LANGUAGE_CONFIGS.rust).toBeDefined()
    })

    it('has go configuration', () => {
      expect(LANGUAGE_CONFIGS.go).toBeDefined()
    })

    it('has java configuration', () => {
      expect(LANGUAGE_CONFIGS.java).toBeDefined()
    })
  })

  describe('TypeScript configuration', () => {
    let config: LanguageConfig

    it('has parser', () => {
      config = LANGUAGE_CONFIGS.typescript
      expect(config.parser).toBeDefined()
    })

    it('has entity types with function_declaration', () => {
      config = LANGUAGE_CONFIGS.typescript
      expect(config.entityTypes.function_declaration).toBe('function')
    })

    it('has entity types with arrow_function', () => {
      config = LANGUAGE_CONFIGS.typescript
      expect(config.entityTypes.arrow_function).toBe('function')
    })

    it('has entity types with class_declaration', () => {
      config = LANGUAGE_CONFIGS.typescript
      expect(config.entityTypes.class_declaration).toBe('class')
    })

    it('has entity types with method_definition', () => {
      config = LANGUAGE_CONFIGS.typescript
      expect(config.entityTypes.method_definition).toBe('method')
    })

    it('has import types with import_statement', () => {
      config = LANGUAGE_CONFIGS.typescript
      expect(config.importTypes).toContain('import_statement')
    })

    it('import types contains only import_statement', () => {
      config = LANGUAGE_CONFIGS.typescript
      expect(config.importTypes).toEqual(['import_statement'])
    })
  })

  describe('JavaScript configuration', () => {
    let config: LanguageConfig

    it('has parser', () => {
      config = LANGUAGE_CONFIGS.javascript
      expect(config.parser).toBeDefined()
    })

    it('has entity types with function_declaration', () => {
      config = LANGUAGE_CONFIGS.javascript
      expect(config.entityTypes.function_declaration).toBe('function')
    })

    it('has entity types with arrow_function', () => {
      config = LANGUAGE_CONFIGS.javascript
      expect(config.entityTypes.arrow_function).toBe('function')
    })

    it('has entity types with class_declaration', () => {
      config = LANGUAGE_CONFIGS.javascript
      expect(config.entityTypes.class_declaration).toBe('class')
    })

    it('has entity types with method_definition', () => {
      config = LANGUAGE_CONFIGS.javascript
      expect(config.entityTypes.method_definition).toBe('method')
    })

    it('has import types with import_statement', () => {
      config = LANGUAGE_CONFIGS.javascript
      expect(config.importTypes).toContain('import_statement')
    })

    it('import types contains only import_statement', () => {
      config = LANGUAGE_CONFIGS.javascript
      expect(config.importTypes).toEqual(['import_statement'])
    })

    it('uses same parser as typescript', () => {
      const tsConfig = LANGUAGE_CONFIGS.typescript
      const jsConfig = LANGUAGE_CONFIGS.javascript
      expect(jsConfig.parser).toEqual(tsConfig.parser)
    })
  })

  describe('Python configuration', () => {
    let config: LanguageConfig

    it('has parser', () => {
      config = LANGUAGE_CONFIGS.python
      expect(config.parser).toBeDefined()
    })

    it('has entity types with function_definition', () => {
      config = LANGUAGE_CONFIGS.python
      expect(config.entityTypes.function_definition).toBe('function')
    })

    it('has entity types with async_function_definition', () => {
      config = LANGUAGE_CONFIGS.python
      expect(config.entityTypes.async_function_definition).toBe('function')
    })

    it('has entity types with class_definition', () => {
      config = LANGUAGE_CONFIGS.python
      expect(config.entityTypes.class_definition).toBe('class')
    })

    it('has import types with import_statement', () => {
      config = LANGUAGE_CONFIGS.python
      expect(config.importTypes).toContain('import_statement')
    })

    it('has import types with import_from_statement', () => {
      config = LANGUAGE_CONFIGS.python
      expect(config.importTypes).toContain('import_from_statement')
    })

    it('import types contains import_statement and import_from_statement', () => {
      config = LANGUAGE_CONFIGS.python
      expect(config.importTypes).toEqual(['import_statement', 'import_from_statement'])
    })
  })

  describe('Rust configuration', () => {
    it('has parser', () => {
      expect(LANGUAGE_CONFIGS.rust.parser).toBeDefined()
    })

    it('has entity types with function_item', () => {
      expect(LANGUAGE_CONFIGS.rust.entityTypes.function_item).toBe('function')
    })

    it('has entity types with struct_item', () => {
      expect(LANGUAGE_CONFIGS.rust.entityTypes.struct_item).toBe('class')
    })

    it('has entity types with impl_item', () => {
      expect(LANGUAGE_CONFIGS.rust.entityTypes.impl_item).toBe('class')
    })

    it('has entity types with trait_item', () => {
      expect(LANGUAGE_CONFIGS.rust.entityTypes.trait_item).toBe('class')
    })

    it('has import types with use_declaration', () => {
      expect(LANGUAGE_CONFIGS.rust.importTypes).toEqual(['use_declaration'])
    })
  })

  describe('Go configuration', () => {
    it('has parser', () => {
      expect(LANGUAGE_CONFIGS.go.parser).toBeDefined()
    })

    it('has entity types with function_declaration', () => {
      expect(LANGUAGE_CONFIGS.go.entityTypes.function_declaration).toBe('function')
    })

    it('has entity types with method_declaration', () => {
      expect(LANGUAGE_CONFIGS.go.entityTypes.method_declaration).toBe('method')
    })

    it('has entity types with type_spec', () => {
      expect(LANGUAGE_CONFIGS.go.entityTypes.type_spec).toBe('class')
    })

    it('has import types with import_spec', () => {
      expect(LANGUAGE_CONFIGS.go.importTypes).toEqual(['import_spec'])
    })
  })

  describe('Java configuration', () => {
    it('has parser', () => {
      expect(LANGUAGE_CONFIGS.java.parser).toBeDefined()
    })

    it('has entity types with class_declaration', () => {
      expect(LANGUAGE_CONFIGS.java.entityTypes.class_declaration).toBe('class')
    })

    it('has entity types with method_declaration', () => {
      expect(LANGUAGE_CONFIGS.java.entityTypes.method_declaration).toBe('method')
    })

    it('has entity types with interface_declaration', () => {
      expect(LANGUAGE_CONFIGS.java.entityTypes.interface_declaration).toBe('class')
    })

    it('has entity types with constructor_declaration', () => {
      expect(LANGUAGE_CONFIGS.java.entityTypes.constructor_declaration).toBe('method')
    })

    it('has import types with import_declaration', () => {
      expect(LANGUAGE_CONFIGS.java.importTypes).toEqual(['import_declaration'])
    })
  })
})
