import { ASTParser } from '@pleaseai/rpg-utils/ast'
import { beforeEach, describe, expect, it } from 'vitest'

describe('ASTParser - Java', () => {
  let parser: ASTParser

  beforeEach(() => {
    parser = new ASTParser()
  })

  it('supports java language', () => {
    expect(parser.isLanguageSupported('java')).toBe(true)
  })

  describe('parse - Java entities', () => {
    it('extracts class_declaration', async () => {
      const source = `public class User {
    private String name;
}`
      const result = await parser.parse(source, 'java')

      const classEntity = result.entities.find(e => e.type === 'class' && e.name === 'User')
      expect(classEntity).toBeDefined()
    })

    it('extracts method_declaration', async () => {
      const source = `public class Service {
    public String greet(String name) {
        return "Hello, " + name;
    }
}`
      const result = await parser.parse(source, 'java')

      const methodEntity = result.entities.find(e => e.type === 'method' && e.name === 'greet')
      expect(methodEntity).toBeDefined()
    })

    it('extracts interface_declaration', async () => {
      const source = `public interface Greeter {
    String greet(String name);
}`
      const result = await parser.parse(source, 'java')

      const ifaceEntity = result.entities.find(e => e.name === 'Greeter')
      expect(ifaceEntity).toBeDefined()
      expect(ifaceEntity!.type).toBe('class')
    })

    it('extracts constructor_declaration', async () => {
      const source = `public class User {
    private String name;
    public User(String name) {
        this.name = name;
    }
}`
      const result = await parser.parse(source, 'java')

      const ctorEntity = result.entities.find(e => e.name === 'User' && e.type === 'method')
      expect(ctorEntity).toBeDefined()
    })
  })

  describe('parse - Java imports', () => {
    it('extracts import declaration', async () => {
      const source = `import java.util.List;`
      const result = await parser.parse(source, 'java')

      expect(result.imports).toHaveLength(1)
      expect(result.imports[0].module).toBe('java.util.List')
    })

    it('extracts static import', async () => {
      const source = `import static org.junit.Assert.*;`
      const result = await parser.parse(source, 'java')

      expect(result.imports).toHaveLength(1)
      expect(result.imports[0].module).toContain('org.junit.Assert')
    })

    it('extracts multiple imports', async () => {
      const source = `import java.util.List;
import java.util.Map;
import java.io.IOException;`
      const result = await parser.parse(source, 'java')

      expect(result.imports).toHaveLength(3)
      const modules = result.imports.map(i => i.module)
      expect(modules).toContain('java.util.List')
      expect(modules).toContain('java.util.Map')
      expect(modules).toContain('java.io.IOException')
    })

    it('handles empty source', async () => {
      const result = await parser.parse('', 'java')
      expect(result.entities).toEqual([])
      expect(result.imports).toEqual([])
      expect(result.errors).toEqual([])
    })
  })
})
