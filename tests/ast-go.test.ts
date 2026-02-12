import { ASTParser } from '@pleaseai/rpg-utils/ast'
import { beforeEach, describe, expect, it } from 'vitest'

describe('ASTParser - Go', () => {
  let parser: ASTParser

  beforeEach(() => {
    parser = new ASTParser()
  })

  it('supports go language', () => {
    expect(parser.isLanguageSupported('go')).toBe(true)
  })

  describe('parse - Go entities', () => {
    it('extracts function_declaration', async () => {
      const source = 'func greet(name string) string {\n  return "Hello, " + name\n}'
      const result = await parser.parse(source, 'go')

      expect(result.entities).toHaveLength(1)
      expect(result.entities[0]).toMatchObject({
        type: 'function',
        name: 'greet',
        startLine: 1,
        endLine: 3,
      })
    })

    it('extracts method_declaration with receiver type', async () => {
      const source = 'func (u *User) Greet() string {\n  return "Hello, " + u.Name\n}'
      const result = await parser.parse(source, 'go')

      expect(result.entities).toHaveLength(1)
      expect(result.entities[0]).toMatchObject({
        type: 'method',
        name: 'Greet',
        parent: 'User',
      })
    })

    it('extracts type_declaration (struct)', async () => {
      const source = 'type User struct {\n  Name string\n  Age  int\n}'
      const result = await parser.parse(source, 'go')

      const typeEntity = result.entities.find(e => e.name === 'User')
      expect(typeEntity).toBeDefined()
      expect(typeEntity!.type).toBe('class')
    })

    it('extracts type_declaration (interface)', async () => {
      const source = 'type Greeter interface {\n  Greet() string\n}'
      const result = await parser.parse(source, 'go')

      const typeEntity = result.entities.find(e => e.name === 'Greeter')
      expect(typeEntity).toBeDefined()
    })
  })

  describe('parse - Go imports', () => {
    it('extracts single import', async () => {
      const source = `import "fmt"`
      const result = await parser.parse(source, 'go')

      expect(result.imports).toHaveLength(1)
      expect(result.imports[0].module).toBe('fmt')
    })

    it('extracts grouped imports', async () => {
      const source = 'import (\n  "fmt"\n  "os"\n  "strings"\n)'
      const result = await parser.parse(source, 'go')

      expect(result.imports.length).toBeGreaterThanOrEqual(1)
      const modules = result.imports.map(i => i.module)
      expect(modules).toContain('fmt')
      expect(modules).toContain('os')
      expect(modules).toContain('strings')
    })

    it('handles empty source', async () => {
      const result = await parser.parse('', 'go')
      expect(result.entities).toEqual([])
      expect(result.imports).toEqual([])
      expect(result.errors).toEqual([])
    })
  })
})
