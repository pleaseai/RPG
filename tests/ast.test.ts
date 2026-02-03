import { beforeEach, describe, expect, test } from 'vitest'
import { ASTParser, type CodeEntity, type ParseResult } from '../src/utils/ast'

describe('ASTParser', () => {
  let parser: ASTParser

  beforeEach(() => {
    parser = new ASTParser()
  })

  describe('constructor', () => {
    test('creates parser instance', () => {
      expect(parser).toBeDefined()
    })

    test('supports TypeScript language', () => {
      expect(parser.isLanguageSupported('typescript')).toBe(true)
    })

    test('supports Python language', () => {
      expect(parser.isLanguageSupported('python')).toBe(true)
    })

    test('returns false for unsupported languages', () => {
      expect(parser.isLanguageSupported('unknown')).toBe(false)
    })
  })

  describe('detectLanguage', () => {
    test('detects TypeScript from .ts extension', () => {
      expect(parser.detectLanguage('file.ts')).toBe('typescript')
    })

    test('detects TypeScript from .tsx extension', () => {
      expect(parser.detectLanguage('file.tsx')).toBe('typescript')
    })

    test('detects JavaScript from .js extension', () => {
      expect(parser.detectLanguage('file.js')).toBe('javascript')
    })

    test('detects Python from .py extension', () => {
      expect(parser.detectLanguage('file.py')).toBe('python')
    })

    test('returns unknown for unsupported extensions', () => {
      expect(parser.detectLanguage('file.xyz')).toBe('unknown')
    })
  })

  describe('parse - TypeScript', () => {
    test('parses empty file', async () => {
      const result = await parser.parse('', 'typescript')

      expect(result.language).toBe('typescript')
      expect(result.entities).toEqual([])
      expect(result.imports).toEqual([])
      expect(result.errors).toEqual([])
    })

    test('extracts function declaration', async () => {
      const source = `function greet(name: string): string {
  return 'Hello, ' + name
}`
      const result = await parser.parse(source, 'typescript')

      expect(result.entities).toHaveLength(1)
      expect(result.entities[0]).toMatchObject({
        type: 'function',
        name: 'greet',
        startLine: 1,
        endLine: 3,
      })
    })

    test('extracts arrow function', async () => {
      const source = `const add = (a: number, b: number) => a + b`
      const result = await parser.parse(source, 'typescript')

      expect(result.entities.some((e) => e.type === 'function' && e.name === 'add')).toBe(true)
    })

    test('extracts class declaration', async () => {
      const source = `class User {
  name: string
  constructor(name: string) {
    this.name = name
  }
  greet() {
    return 'Hello, ' + this.name
  }
}`
      const result = await parser.parse(source, 'typescript')

      const classEntity = result.entities.find((e) => e.type === 'class')
      expect(classEntity).toBeDefined()
      expect(classEntity?.name).toBe('User')

      const methodEntities = result.entities.filter((e) => e.type === 'method')
      expect(methodEntities.length).toBeGreaterThanOrEqual(1)
    })

    test('extracts interface declaration', async () => {
      const source = `interface Config {
  name: string
  value: number
}`
      const result = await parser.parse(source, 'typescript')

      // Interface may be extracted as a separate entity type or ignored
      // For now, we just verify parsing doesn't error
      expect(result.errors).toEqual([])
    })

    test('extracts import statements', async () => {
      const source = `import { foo, bar } from './module'
import * as utils from 'utils'
import path from 'path'`
      const result = await parser.parse(source, 'typescript')

      expect(result.imports.length).toBeGreaterThanOrEqual(1)
      expect(result.imports.some((i) => i.module === './module')).toBe(true)
    })

    test('handles syntax errors gracefully', async () => {
      const source = 'function invalid( { incomplete syntax'
      const result = await parser.parse(source, 'typescript')

      // Should return result with errors, not throw
      expect(result).toBeDefined()
      expect(result.errors.length).toBeGreaterThan(0)
    })
  })

  describe('parse - Python', () => {
    test('parses empty file', async () => {
      const result = await parser.parse('', 'python')

      expect(result.language).toBe('python')
      expect(result.entities).toEqual([])
    })

    test('extracts function definition', async () => {
      const source = `def greet(name):
    return f"Hello, {name}"`
      const result = await parser.parse(source, 'python')

      expect(result.entities).toHaveLength(1)
      expect(result.entities[0]).toMatchObject({
        type: 'function',
        name: 'greet',
        startLine: 1,
      })
    })

    test('extracts async function definition', async () => {
      const source = 'async def fetch_data(url):\n    return await client.get(url)'
      const result = await parser.parse(source, 'python')

      expect(result.entities).toHaveLength(1)
      expect(result.entities[0].name).toBe('fetch_data')
    })

    test('extracts class definition', async () => {
      const source = `class User:
    def __init__(self, name):
        self.name = name

    def greet(self):
        return f"Hello, {self.name}"`
      const result = await parser.parse(source, 'python')

      const classEntity = result.entities.find((e) => e.type === 'class')
      expect(classEntity).toBeDefined()
      expect(classEntity?.name).toBe('User')
    })

    test('extracts import statements', async () => {
      const source = `import os
from pathlib import Path
from typing import List, Dict`
      const result = await parser.parse(source, 'python')

      expect(result.imports.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('parseFile', () => {
    test('parses file from path', async () => {
      // Use a file that exists in the project
      const result = await parser.parseFile('./src/utils/ast.ts')

      expect(result.language).toBe('typescript')
      expect(result.entities.length).toBeGreaterThan(0)
    })
  })
})
