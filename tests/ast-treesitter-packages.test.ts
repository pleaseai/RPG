import { describe, expect, it } from 'vitest'

interface LanguagePackageSpec {
  name: string
  packageName: string
  requiredProperties: string[]
}

const languagePackages: LanguagePackageSpec[] = [
  { name: 'tree-sitter-rust', packageName: 'tree-sitter-rust', requiredProperties: ['name', 'language'] },
  { name: 'tree-sitter-go', packageName: 'tree-sitter-go', requiredProperties: ['language'] },
  { name: 'tree-sitter-java', packageName: 'tree-sitter-java', requiredProperties: ['name', 'language'] },
]

describe('tree-sitter language packages', () => {
  for (const pkg of languagePackages) {
    describe(pkg.name, () => {
      it('can be imported', async () => {
        const module = await import(pkg.packageName)
        expect(module).toBeDefined()
      })

      it('returns a valid tree-sitter language object', async () => {
        const module = await import(pkg.packageName)
        const lang = module.default || module
        expect(lang).toBeDefined()
        for (const prop of pkg.requiredProperties) {
          expect(lang).toHaveProperty(prop)
        }
      })
    })
  }
})
