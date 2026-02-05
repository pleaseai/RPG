import { beforeEach, describe, expect, it } from 'vitest'
import { ASTParser } from '../src/utils/ast'

describe('aSTParser', () => {
  let parser: ASTParser

  beforeEach(() => {
    parser = new ASTParser()
  })

  describe('constructor', () => {
    it('creates parser instance', () => {
      expect(parser).toBeDefined()
    })

    it('supports TypeScript language', () => {
      expect(parser.isLanguageSupported('typescript')).toBe(true)
    })

    it('supports Python language', () => {
      expect(parser.isLanguageSupported('python')).toBe(true)
    })

    it('returns false for unsupported languages', () => {
      expect(parser.isLanguageSupported('unknown')).toBe(false)
    })
  })

  describe('detectLanguage', () => {
    it('detects TypeScript from .ts extension', () => {
      expect(parser.detectLanguage('file.ts')).toBe('typescript')
    })

    it('detects TypeScript from .tsx extension', () => {
      expect(parser.detectLanguage('file.tsx')).toBe('typescript')
    })

    it('detects JavaScript from .js extension', () => {
      expect(parser.detectLanguage('file.js')).toBe('javascript')
    })

    it('detects Python from .py extension', () => {
      expect(parser.detectLanguage('file.py')).toBe('python')
    })

    it('returns unknown for unsupported extensions', () => {
      expect(parser.detectLanguage('file.xyz')).toBe('unknown')
    })
  })

  describe('parse - TypeScript', () => {
    it('parses empty file', async () => {
      const result = await parser.parse('', 'typescript')

      expect(result.language).toBe('typescript')
      expect(result.entities).toEqual([])
      expect(result.imports).toEqual([])
      expect(result.errors).toEqual([])
    })

    it('extracts function declaration', async () => {
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

    it('extracts arrow function', async () => {
      const source = `const add = (a: number, b: number) => a + b`
      const result = await parser.parse(source, 'typescript')

      expect(result.entities.some(e => e.type === 'function' && e.name === 'add')).toBe(true)
    })

    it('extracts class declaration', async () => {
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

      const classEntity = result.entities.find(e => e.type === 'class')
      expect(classEntity).toBeDefined()
      expect(classEntity?.name).toBe('User')

      const methodEntities = result.entities.filter(e => e.type === 'method')
      expect(methodEntities.length).toBeGreaterThanOrEqual(1)
    })

    it('extracts interface declaration', async () => {
      const source = `interface Config {
  name: string
  value: number
}`
      const result = await parser.parse(source, 'typescript')

      // Interface may be extracted as a separate entity type or ignored
      // For now, we just verify parsing doesn't error
      expect(result.errors).toEqual([])
    })

    it('extracts import statements', async () => {
      const source = `import { foo, bar } from './module'
import * as utils from 'utils'
import path from 'path'`
      const result = await parser.parse(source, 'typescript')

      expect(result.imports.length).toBeGreaterThanOrEqual(1)
      expect(result.imports.some(i => i.module === './module')).toBe(true)
    })

    it('handles syntax errors gracefully', async () => {
      const source = 'function invalid( { incomplete syntax'
      const result = await parser.parse(source, 'typescript')

      // Should return result with errors, not throw
      expect(result).toBeDefined()
      expect(result.errors.length).toBeGreaterThan(0)
    })
  })

  describe('parse - Python', () => {
    it('parses empty file', async () => {
      const result = await parser.parse('', 'python')

      expect(result.language).toBe('python')
      expect(result.entities).toEqual([])
    })

    it('extracts function definition', async () => {
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

    it('extracts async function definition', async () => {
      const source = 'async def fetch_data(url):\n    return await client.get(url)'
      const result = await parser.parse(source, 'python')

      expect(result.entities).toHaveLength(1)
      expect(result.entities[0].name).toBe('fetch_data')
    })

    it('extracts class definition', async () => {
      const source = `class User:
    def __init__(self, name):
        self.name = name

    def greet(self):
        return f"Hello, {self.name}"`
      const result = await parser.parse(source, 'python')

      const classEntity = result.entities.find(e => e.type === 'class')
      expect(classEntity).toBeDefined()
      expect(classEntity?.name).toBe('User')
    })

    it('extracts import statements', async () => {
      const source = `import os
from pathlib import Path
from typing import List, Dict`
      const result = await parser.parse(source, 'python')

      expect(result.imports.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('parseFile', () => {
    it('parses file from path', async () => {
      // Use a file that exists in the project
      const result = await parser.parseFile('./src/utils/ast.ts')

      expect(result.language).toBe('typescript')
      expect(result.entities.length).toBeGreaterThan(0)
    })
  })
})
