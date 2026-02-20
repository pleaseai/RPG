import {
  COMMON_METHOD_BLOCKLIST,
  INFERENCE_PATTERNS,
} from '@pleaseai/rpg-encoder/type-inference-patterns'
import { describe, expect, it } from 'vitest'

describe('INFERENCE_PATTERNS', () => {
  describe('supported languages', () => {
    it('exports patterns for all 6 supported languages', () => {
      const languages = ['typescript', 'javascript', 'python', 'java', 'rust', 'go']
      for (const lang of languages) {
        expect(INFERENCE_PATTERNS[lang]).toBeDefined()
      }
    })

    it('each language has required pattern fields', () => {
      for (const patterns of Object.values(INFERENCE_PATTERNS)) {
        expect(typeof patterns.localVarAssignment).toBe('string')
        expect(typeof patterns.attributeAssignment).toBe('string')
        expect(typeof patterns.extractLocalVar).toBe('function')
        expect(typeof patterns.extractAttribute).toBe('function')
      }
    })
  })

  describe('Python patterns', () => {
    const patterns = INFERENCE_PATTERNS.python

    describe('extractLocalVar', () => {
      it('returns varName and typeName for a simple mock match', () => {
        const mockMatch = {
          captures: {
            var: { text: 'x' },
            type: { text: 'Foo' },
          },
        }
        const result = patterns.extractLocalVar(mockMatch)
        expect(result).not.toBeNull()
        expect(result?.varName).toBe('x')
        expect(result?.typeName).toBe('Foo')
      })

      it('returns null for missing var capture', () => {
        const mockMatch = {
          captures: {
            type: { text: 'Foo' },
          },
        }
        const result = patterns.extractLocalVar(mockMatch)
        expect(result).toBeNull()
      })

      it('returns null for missing type capture', () => {
        const mockMatch = {
          captures: {
            var: { text: 'x' },
          },
        }
        const result = patterns.extractLocalVar(mockMatch)
        expect(result).toBeNull()
      })

      it('returns null for empty type name', () => {
        const mockMatch = {
          captures: {
            var: { text: 'x' },
            type: { text: '' },
          },
        }
        const result = patterns.extractLocalVar(mockMatch)
        expect(result).toBeNull()
      })
    })

    describe('extractAttribute', () => {
      it('returns attrName and typeName for a simple mock match', () => {
        const mockMatch = {
          captures: {
            attr: { text: 'helper' },
            type: { text: 'HelperService' },
          },
        }
        const result = patterns.extractAttribute(mockMatch)
        expect(result).not.toBeNull()
        expect(result?.attrName).toBe('helper')
        expect(result?.typeName).toBe('HelperService')
      })

      it('returns null for missing attr capture', () => {
        const mockMatch = {
          captures: {
            type: { text: 'Foo' },
          },
        }
        const result = patterns.extractAttribute(mockMatch)
        expect(result).toBeNull()
      })

      it('returns null for missing type capture', () => {
        const mockMatch = {
          captures: {
            attr: { text: 'field' },
          },
        }
        const result = patterns.extractAttribute(mockMatch)
        expect(result).toBeNull()
      })
    })
  })

  describe('TypeScript patterns', () => {
    const patterns = INFERENCE_PATTERNS.typescript

    describe('extractLocalVar', () => {
      it('returns varName and typeName for a simple mock match', () => {
        const mockMatch = {
          captures: {
            var: { text: 'service' },
            type: { text: 'MyService' },
          },
        }
        const result = patterns.extractLocalVar(mockMatch)
        expect(result).not.toBeNull()
        expect(result?.varName).toBe('service')
        expect(result?.typeName).toBe('MyService')
      })

      it('returns null when captures are missing', () => {
        const result = patterns.extractLocalVar({ captures: {} })
        expect(result).toBeNull()
      })
    })

    describe('extractAttribute', () => {
      it('returns attrName and typeName for a simple mock match', () => {
        const mockMatch = {
          captures: {
            attr: { text: 'repo' },
            type: { text: 'UserRepository' },
          },
        }
        const result = patterns.extractAttribute(mockMatch)
        expect(result).not.toBeNull()
        expect(result?.attrName).toBe('repo')
        expect(result?.typeName).toBe('UserRepository')
      })
    })
  })

  describe('JavaScript patterns', () => {
    const patterns = INFERENCE_PATTERNS.javascript

    it('has non-empty localVarAssignment query string', () => {
      expect(patterns.localVarAssignment.length).toBeGreaterThan(0)
    })

    it('has non-empty attributeAssignment query string', () => {
      expect(patterns.attributeAssignment.length).toBeGreaterThan(0)
    })

    it('extractLocalVar returns correct shape', () => {
      const result = patterns.extractLocalVar({
        captures: {
          var: { text: 'obj' },
          type: { text: 'Widget' },
        },
      })
      expect(result).toEqual({ varName: 'obj', typeName: 'Widget' })
    })
  })

  describe('Java patterns', () => {
    const patterns = INFERENCE_PATTERNS.java

    it('has pattern strings defined', () => {
      expect(typeof patterns.localVarAssignment).toBe('string')
      expect(typeof patterns.attributeAssignment).toBe('string')
    })

    it('extractLocalVar works with captures', () => {
      const result = patterns.extractLocalVar({
        captures: {
          var: { text: 'conn' },
          type: { text: 'Connection' },
        },
      })
      expect(result).not.toBeNull()
      expect(result?.varName).toBe('conn')
      expect(result?.typeName).toBe('Connection')
    })

    it('extractAttribute works with captures', () => {
      const result = patterns.extractAttribute({
        captures: {
          attr: { text: 'service' },
          type: { text: 'UserService' },
        },
      })
      expect(result).not.toBeNull()
      expect(result?.attrName).toBe('service')
      expect(result?.typeName).toBe('UserService')
    })
  })

  describe('Rust patterns', () => {
    const patterns = INFERENCE_PATTERNS.rust

    it('has pattern strings defined', () => {
      expect(typeof patterns.localVarAssignment).toBe('string')
      expect(typeof patterns.attributeAssignment).toBe('string')
    })

    it('extractLocalVar works with captures', () => {
      const result = patterns.extractLocalVar({
        captures: {
          var: { text: 'client' },
          type: { text: 'HttpClient' },
        },
      })
      expect(result).not.toBeNull()
      expect(result?.varName).toBe('client')
      expect(result?.typeName).toBe('HttpClient')
    })
  })

  describe('Go patterns', () => {
    const patterns = INFERENCE_PATTERNS.go

    it('has pattern strings defined', () => {
      expect(typeof patterns.localVarAssignment).toBe('string')
      expect(typeof patterns.attributeAssignment).toBe('string')
    })

    it('extractLocalVar works with captures', () => {
      const result = patterns.extractLocalVar({
        captures: {
          var: { text: 'db' },
          type: { text: 'Database' },
        },
      })
      expect(result).not.toBeNull()
      expect(result?.varName).toBe('db')
      expect(result?.typeName).toBe('Database')
    })
  })
})

describe('COMMON_METHOD_BLOCKLIST', () => {
  it('is a Set', () => {
    expect(COMMON_METHOD_BLOCKLIST).toBeInstanceOf(Set)
  })

  it('contains expected common method names', () => {
    const expected = [
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
    ]
    for (const name of expected) {
      expect(COMMON_METHOD_BLOCKLIST.has(name)).toBe(true)
    }
  })

  it('has at least 30 entries', () => {
    expect(COMMON_METHOD_BLOCKLIST.size).toBeGreaterThanOrEqual(30)
  })

  it('does NOT contain domain-specific names', () => {
    expect(COMMON_METHOD_BLOCKLIST.has('authenticate')).toBe(false)
    expect(COMMON_METHOD_BLOCKLIST.has('fetchUser')).toBe(false)
    expect(COMMON_METHOD_BLOCKLIST.has('renderComponent')).toBe(false)
  })
})
