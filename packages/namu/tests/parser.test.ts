import type { NamuNode, SupportedLanguage } from '@pleaseai/soop-namu'

import { describe, expect, it } from 'vitest'

import { createParser, getLanguage, initNamu, isAvailable, prefetchLanguages, SUPPORTED_LANGUAGES, toNativeLanguageName } from '../src/index'

const ALL_LANGS: SupportedLanguage[] = [
  'typescript',
  'javascript',
  'python',
  'rust',
  'go',
  'java',
  'csharp',
  'c',
  'cpp',
  'ruby',
  'kotlin',
]

async function parse(lang: SupportedLanguage, source: string): Promise<NamuNode> {
  const parser = await createParser()
  parser.setLanguage(await getLanguage(lang))
  return parser.parse(source).rootNode
}

describe('namu: native tree-sitter backend', () => {
  it('isAvailable() returns true when the native binding loaded', () => {
    expect(isAvailable()).toBe(true)
  })

  it('exports the curated supported-language set', () => {
    expect([...SUPPORTED_LANGUAGES].sort()).toEqual([...ALL_LANGS].sort())
  })

  it('toNativeLanguageName maps supported languages to valid pack names', () => {
    expect(toNativeLanguageName('typescript')).toBe('typescript')
    expect(toNativeLanguageName('csharp')).toBe('csharp')
    expect(toNativeLanguageName('cpp')).toBe('cpp')
  })

  describe('initialization', () => {
    it('initNamu() resolves', async () => {
      await expect(initNamu()).resolves.toBeUndefined()
    })

    it('initNamu() is idempotent', async () => {
      await initNamu()
      await expect(initNamu()).resolves.toBeUndefined()
    })

    it('createParser() returns a parser instance', async () => {
      expect(await createParser()).toBeDefined()
    })
  })

  describe('parser provisioning', () => {
    it('prefetchLanguages() resolves to a count without throwing', async () => {
      const count = await prefetchLanguages(['typescript'])
      expect(typeof count).toBe('number')
      expect(count).toBeGreaterThanOrEqual(0)
    })

    it('prefetchLanguages() defaults to the curated supported set', async () => {
      await expect(prefetchLanguages()).resolves.toBeGreaterThanOrEqual(0)
    })
  })

  describe('language loading', () => {
    it.each(ALL_LANGS)('getLanguage(%s) resolves a handle', async (lang) => {
      expect(await getLanguage(lang)).toBeDefined()
    })

    it('getLanguage throws for an unavailable language', async () => {
      await expect(getLanguage('not-a-language' as SupportedLanguage)).rejects.toThrow(/not available/)
    })

    it('parse() throws when no language is set', async () => {
      const parser = await createParser()
      expect(() => parser.parse('x')).toThrow(/setLanguage/)
    })
  })

  describe('parsing', () => {
    it('parses TypeScript into a program tree', async () => {
      const root = await parse('typescript', 'function hello(name: string): string { return name }')
      expect(root.type).toBe('program')
      expect(root.hasError).toBe(false)
    })

    it('parses JavaScript', async () => {
      const root = await parse('javascript', 'const x = 42')
      expect(root.type).toBe('program')
      expect(root.hasError).toBe(false)
    })

    it('parses Python into a module tree', async () => {
      const root = await parse('python', 'def greet(name):\n  return name')
      expect(root.type).toBe('module')
      expect(root.hasError).toBe(false)
    })

    it('parses Rust into a source_file tree', async () => {
      const root = await parse('rust', 'fn main() { println!("hi"); }')
      expect(root.type).toBe('source_file')
      expect(root.hasError).toBe(false)
    })

    it('flags syntax errors via hasError', async () => {
      const root = await parse('typescript', 'function (')
      expect(root.hasError).toBe(true)
    })
  })

  describe('NamuNode adapter surface', () => {
    it('exposes type, text, children and positions', async () => {
      const root = await parse('typescript', 'const x = 1')
      expect(typeof root.type).toBe('string')
      expect(typeof root.text).toBe('string')
      expect(Array.isArray(root.children)).toBe(true)
      expect(typeof root.startPosition.row).toBe('number')
      expect(typeof root.endPosition.column).toBe('number')
    })

    it('slices .text from source byte offsets', async () => {
      const root = await parse('typescript', 'const answer = 42')
      // root text is the whole source
      expect(root.text).toBe('const answer = 42')
      const decl = root.namedChild(0)!
      expect(decl.type).toBe('lexical_declaration')
      expect(decl.text).toBe('const answer = 42')
    })

    it('slices .text correctly when preceded by multi-byte (non-ASCII) source', async () => {
      // Korean comment + string force byte offsets to diverge from UTF-16 indices.
      // String.prototype.slice on byte offsets would corrupt these — the adapter
      // must decode a UTF-8 byte slice instead.
      const src = '// 한국어 주석\nfunction greet() { return "안녕하세요 세계" }'
      const root = await parse('typescript', src)
      const fn = root.namedChild(1)!
      expect(fn.type).toBe('function_declaration')
      expect(fn.childForFieldName('name')!.text).toBe('greet')
      // The whole function node's text must be intact despite the preceding
      // multi-byte comment shifting its byte start past its UTF-16 start.
      expect(fn.text).toBe('function greet() { return "안녕하세요 세계" }')
    })

    it('resolves field children via childForFieldName', async () => {
      const root = await parse('typescript', 'function add(a, b) { return a + b }')
      const fn = root.namedChild(0)!
      expect(fn.type).toBe('function_declaration')
      const name = fn.childForFieldName('name')
      expect(name).not.toBeNull()
      expect(name!.text).toBe('add')
    })

    it('computes previousSibling/nextSibling from the parent child list', async () => {
      const root = await parse('typescript', 'const a = 1\nconst b = 2')
      const first = root.child(0)!
      const second = root.child(1)!
      expect(first.nextSibling).toBe(second)
      expect(second.previousSibling).toBe(first)
      expect(first.previousSibling).toBeNull()
      expect(second.nextSibling).toBeNull()
    })

    it('computes correct siblings for nodes reached via namedChild (full-list index)', async () => {
      // Array elements are named children interspersed with unnamed tokens
      // ('[', ',', ']'), so a named child's named-list index differs from its
      // full-children index — exercises the namedChildren index correctness.
      const root = await parse('typescript', 'const a = [x, y]')
      const arr = root.namedChild(0)!.namedChild(0)!.childForFieldName('value')!
      expect(arr.type).toBe('array')
      const second = arr.namedChild(1)! // `y`
      expect(second.text).toBe('y')
      // Immediate previous sibling in the FULL child list is the comma, not `x`.
      expect(second.previousSibling!.type).toBe(',')
      expect(second.nextSibling!.type).toBe(']')
    })

    it('exposes a leading comment as a previousSibling', async () => {
      const root = await parse('typescript', '// doc\nfunction f() {}')
      const fn = root.namedChild(1)!
      expect(fn.type).toBe('function_declaration')
      const prev = fn.previousSibling
      expect(prev).not.toBeNull()
      expect(prev!.type).toBe('comment')
      expect(prev!.text).toBe('// doc')
    })

    it('links child.parent back to the containing node', async () => {
      const root = await parse('typescript', 'function f() {}')
      const fn = root.namedChild(0)!
      expect(fn.parent).toBe(root)
      expect(root.parent).toBeNull()
    })

    it('reports startIndex/endIndex as byte offsets and isNamed', async () => {
      const root = await parse('typescript', 'const x = 1')
      expect(root.startIndex).toBe(0)
      expect(root.endIndex).toBe('const x = 1'.length)
      expect(root.isNamed).toBe(true)
    })
  })
})
