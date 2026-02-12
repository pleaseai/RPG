import type { CodeEntity, LanguageConfig, ParseResult, SupportedLanguage } from '@pleaseai/rpg-utils/ast/types'
import { describe, expect, it } from 'vitest'

describe('AST Types', () => {
  describe('imports', () => {
    it('should import types from ast/types', async () => {
      const module = await import('@pleaseai/rpg-utils/ast/types')
      expect(module).toBeDefined()
    })
  })

  describe('CodeEntity type', () => {
    it('should have required properties', () => {
      // This is a type-level test - we're checking the interface definition
      // by creating an object that conforms to it
      const entity: CodeEntity = {
        type: 'function',
        name: 'myFunction',
        startLine: 1,
        endLine: 5,
        startColumn: 0,
        endColumn: 10,
      }
      expect(entity.type).toBe('function')
      expect(entity.name).toBe('myFunction')
    })
  })

  describe('ParseResult type', () => {
    it('should have required properties', () => {
      const result: ParseResult = {
        language: 'typescript',
        entities: [],
        imports: [],
        errors: [],
      }
      expect(result.language).toBe('typescript')
      expect(Array.isArray(result.entities)).toBe(true)
    })
  })

  describe('SupportedLanguage type', () => {
    it('should support typescript', () => {
      const lang: SupportedLanguage = 'typescript'
      expect(lang).toBe('typescript')
    })

    it('should support javascript', () => {
      const lang: SupportedLanguage = 'javascript'
      expect(lang).toBe('javascript')
    })

    it('should support python', () => {
      const lang: SupportedLanguage = 'python'
      expect(lang).toBe('python')
    })

    it('should support rust', () => {
      const lang: SupportedLanguage = 'rust'
      expect(lang).toBe('rust')
    })

    it('should support go', () => {
      const lang: SupportedLanguage = 'go'
      expect(lang).toBe('go')
    })

    it('should support java', () => {
      const lang: SupportedLanguage = 'java'
      expect(lang).toBe('java')
    })
  })

  describe('LanguageConfig type', () => {
    it('should have required properties', () => {
      const config: LanguageConfig = {
        parser: {},
        entityTypes: {},
        importTypes: [],
      }
      expect(config).toBeDefined()
    })
  })
})
