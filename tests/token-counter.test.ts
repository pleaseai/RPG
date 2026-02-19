import type { EntityInput } from '@pleaseai/rpg-encoder/semantic'
import { estimateBatchTokens, estimateEntityTokens, estimateTokenCount } from '@pleaseai/rpg-encoder/token-counter'
import { describe, expect, it } from 'vitest'

describe('token counter', () => {
  describe('estimateTokenCount', () => {
    it('returns 0 for empty string', () => {
      const count = estimateTokenCount('')
      expect(count).toBe(0)
    })

    it('estimates tokens for short text', () => {
      // 4 chars = 1 token
      const text = 'test' // 4 chars
      const count = estimateTokenCount(text)
      expect(count).toBe(1)
    })

    it('estimates tokens using ceil division by 4', () => {
      // 5 chars = ceil(5/4) = 2 tokens
      const text = 'tests' // 5 chars
      const count = estimateTokenCount(text)
      expect(count).toBe(2)
    })

    it('estimates tokens for longer code text', () => {
      const text = 'function validateEmail(email: string): boolean { return true; }'
      const count = estimateTokenCount(text)
      // Length is 63 chars, ceil(63/4) = 16 tokens
      expect(count).toBe(16)
    })

    it('handles whitespace and special characters', () => {
      const text = '  \n\t  ' // 7 chars with whitespace
      const count = estimateTokenCount(text)
      expect(count).toBe(2) // ceil(7/4) = 2
    })

    it('returns correct estimate for typical source code snippet', () => {
      const sourceCode = `
        export async function fetchUserData(userId: string): Promise<User> {
          const response = await api.get(\`/users/\${userId}\`);
          return response.data;
        }
      `
      const count = estimateTokenCount(sourceCode)
      // Should be roughly characters/4
      expect(count).toBeGreaterThan(0)
      expect(count).toBe(Math.ceil(sourceCode.length / 4))
    })
  })

  describe('estimateEntityTokens', () => {
    it('returns overhead for entity without source code', () => {
      const entity: EntityInput = {
        type: 'function',
        name: 'getValue',
        filePath: 'src/utils.ts',
      }
      const count = estimateEntityTokens(entity)
      // Should include ~200 tokens overhead for prompt template
      expect(count).toBe(200)
    })

    it('combines source code tokens with overhead', () => {
      const entity: EntityInput = {
        type: 'function',
        name: 'getValue',
        filePath: 'src/utils.ts',
        sourceCode: 'function getValue() { return 42; }', // 34 chars = 9 tokens
      }
      const count = estimateEntityTokens(entity)
      // 9 tokens (source) + 200 (overhead) = 209
      expect(count).toBe(209)
    })

    it('includes documentation tokens if provided', () => {
      const entity: EntityInput = {
        type: 'function',
        name: 'getValue',
        filePath: 'src/utils.ts',
        sourceCode: 'function getValue() { return 42; }', // 34 chars = 9 tokens
        documentation: 'Retrieve a numeric value', // 24 chars = 6 tokens
      }
      const count = estimateEntityTokens(entity)
      // 9 (source) + 6 (doc) + 200 (overhead) = 215
      expect(count).toBe(215)
    })

    it('handles undefined sourceCode gracefully', () => {
      const entity: EntityInput = {
        type: 'class',
        name: 'UserService',
        filePath: 'src/services/user.ts',
        sourceCode: undefined,
      }
      const count = estimateEntityTokens(entity)
      expect(count).toBe(200) // Just overhead
    })

    it('handles null sourceCode gracefully', () => {
      const entity: EntityInput = {
        type: 'class',
        name: 'UserService',
        filePath: 'src/services/user.ts',
        sourceCode: null as any,
      }
      const count = estimateEntityTokens(entity)
      expect(count).toBe(200) // Just overhead
    })

    it('calculates tokens for real-world entity', () => {
      const entity: EntityInput = {
        type: 'function',
        name: 'validateUserInput',
        filePath: 'packages/utils/src/validation.ts',
        sourceCode: `
          export function validateUserInput(input: unknown): boolean {
            if (!input || typeof input !== 'object') return false;
            const user = input as any;
            return typeof user.email === 'string' && user.email.includes('@');
          }
        `,
        documentation: 'Validates user object structure and email format',
      }
      const count = estimateEntityTokens(entity)
      const sourceTokens = Math.ceil(entity.sourceCode!.length / 4)
      const docTokens = Math.ceil(entity.documentation!.length / 4)
      const expected = sourceTokens + docTokens + 200
      expect(count).toBe(expected)
    })
  })

  describe('estimateBatchTokens', () => {
    it('returns 0 for empty batch', () => {
      const count = estimateBatchTokens([])
      expect(count).toBe(0)
    })

    it('sums tokens for multiple entities', () => {
      const entities: EntityInput[] = [
        {
          type: 'function',
          name: 'foo',
          filePath: 'src/a.ts',
          sourceCode: 'x', // 1 token
        },
        {
          type: 'function',
          name: 'bar',
          filePath: 'src/b.ts',
          sourceCode: 'yyyy', // 1 token
        },
      ]
      const count = estimateBatchTokens(entities)
      // (1 + 200) + (1 + 200) = 402
      expect(count).toBe(402)
    })

    it('correctly sums batch with varied entities', () => {
      const entities: EntityInput[] = [
        {
          type: 'function',
          name: 'simple',
          filePath: 'src/a.ts',
        },
        {
          type: 'class',
          name: 'Service',
          filePath: 'src/b.ts',
          sourceCode: 'class Service {}',
        },
        {
          type: 'method',
          name: 'process',
          filePath: 'src/c.ts',
          sourceCode: 'function process(data) { return data.map(x => x * 2); }',
          documentation: 'Process data array',
        },
      ]
      const count = estimateBatchTokens(entities)

      // Entity 1: 0 (no source) + 200 = 200
      // Entity 2: ceil(16/4) + 200 = 4 + 200 = 204
      // Entity 3: ceil(55/4) + ceil(18/4) + 200 = 14 + 5 + 200 = 219
      // Total: 200 + 204 + 219 = 623
      expect(count).toBe(623)
    })

    it('handles large batch of entities', () => {
      const entities: EntityInput[] = Array.from({ length: 10 }, (_, i) => ({
        type: 'function',
        name: `func${i}`,
        filePath: `src/file${i}.ts`,
        sourceCode: 'const x = 1;'.repeat(5), // 60 chars = 15 tokens per entity
      }))

      const count = estimateBatchTokens(entities)
      // Each entity: 15 (source) + 200 (overhead) = 215
      // 10 entities: 10 * 215 = 2150
      expect(count).toBe(2150)
    })

    it('includes documentation in batch calculation', () => {
      const entities: EntityInput[] = [
        {
          type: 'function',
          name: 'fetch',
          filePath: 'src/api.ts',
          sourceCode: 'async function fetch() {}',
          documentation: 'Fetch data from API',
        },
        {
          type: 'function',
          name: 'parse',
          filePath: 'src/parser.ts',
          sourceCode: 'function parse(text) { return JSON.parse(text); }',
        },
      ]

      const count = estimateBatchTokens(entities)
      // Entity 1: ceil(25/4) + ceil(19/4) + 200 = 7 + 5 + 200 = 212
      // Entity 2: ceil(49/4) + 200 = 13 + 200 = 213
      // Total: 425
      expect(count).toBe(425)
    })
  })
})
