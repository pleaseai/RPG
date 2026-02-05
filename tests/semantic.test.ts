import type { EntityInput } from '../src/encoder/semantic'
import { describe, expect, it } from 'vitest'
import { SemanticExtractor } from '../src/encoder/semantic'

describe('semanticExtractor', () => {
  const extractor = new SemanticExtractor({ useLLM: false })

  describe('heuristic extraction', () => {
    it('extracts semantic features for function', async () => {
      const input: EntityInput = {
        type: 'function',
        name: 'validateUserInput',
        filePath: 'src/utils/validation.ts',
      }

      const feature = await extractor.extract(input)

      expect(feature.description).toContain('validate')
      expect(feature.keywords).toContain('function')
      expect(feature.keywords.length).toBeGreaterThan(0)
    })

    it('extracts semantic features for class', async () => {
      const input: EntityInput = {
        type: 'class',
        name: 'UserService',
        filePath: 'src/services/user.ts',
      }

      const feature = await extractor.extract(input)

      expect(feature.description).toContain('class')
      expect(feature.keywords).toContain('class')
      expect(feature.keywords).toContain('user')
    })

    it('extracts semantic features for method', async () => {
      const input: EntityInput = {
        type: 'method',
        name: 'fetchData',
        filePath: 'src/api/client.ts',
        parent: 'ApiClient',
      }

      const feature = await extractor.extract(input)

      expect(feature.description).toContain('fetch')
      expect(feature.keywords).toContain('method')
      expect(feature.keywords).toContain('apiclient')
    })

    it('extracts semantic features for file', async () => {
      const input: EntityInput = {
        type: 'file',
        name: 'encoder',
        filePath: 'src/encoder/encoder.ts',
      }

      const feature = await extractor.extract(input)

      expect(feature.description).toContain('encoder')
      expect(feature.keywords).toContain('file')
    })

    it('handles common function prefixes', async () => {
      const prefixTests = [
        { name: 'getData', expected: 'retrieve' },
        { name: 'setConfig', expected: 'set' },
        { name: 'isValid', expected: 'check' },
        { name: 'hasPermission', expected: 'check' },
        { name: 'createUser', expected: 'create' },
        { name: 'handleError', expected: 'handle' },
        { name: 'parseJSON', expected: 'parse' },
        { name: 'formatDate', expected: 'format' },
      ]

      for (const { name, expected } of prefixTests) {
        const input: EntityInput = {
          type: 'function',
          name,
          filePath: 'test.ts',
        }

        const feature = await extractor.extract(input)
        expect(feature.description.toLowerCase()).toContain(expected)
      }
    })

    it('extracts keywords from camelCase names', async () => {
      const input: EntityInput = {
        type: 'function',
        name: 'getUserDataFromDatabase',
        filePath: 'src/data/user.ts',
      }

      const feature = await extractor.extract(input)

      expect(feature.keywords).toContain('user')
      expect(feature.keywords).toContain('data')
      expect(feature.keywords).toContain('database')
    })

    it('extracts keywords from file path', async () => {
      const input: EntityInput = {
        type: 'function',
        name: 'test',
        filePath: 'src/services/authentication/oauth.ts',
      }

      const feature = await extractor.extract(input)

      expect(feature.keywords).toContain('services')
      expect(feature.keywords).toContain('authentication')
      expect(feature.keywords).toContain('oauth')
    })
  })

  describe('batch extraction', () => {
    it('extracts features for multiple entities', async () => {
      const inputs: EntityInput[] = [
        { type: 'function', name: 'foo', filePath: 'a.ts' },
        { type: 'function', name: 'bar', filePath: 'b.ts' },
        { type: 'class', name: 'Baz', filePath: 'c.ts' },
      ]

      const features = await extractor.extractBatch(inputs)

      expect(features).toHaveLength(3)
      expect(features[0].description).toBeDefined()
      expect(features[1].description).toBeDefined()
      expect(features[2].description).toContain('class')
    })
  })

  describe('edge cases', () => {
    it('handles empty name', async () => {
      const input: EntityInput = {
        type: 'function',
        name: '',
        filePath: 'test.ts',
      }

      const feature = await extractor.extract(input)

      expect(feature.description).toBeDefined()
      expect(feature.keywords).toContain('function')
    })

    it('handles snake_case names', async () => {
      const input: EntityInput = {
        type: 'function',
        name: 'get_user_data',
        filePath: 'test.py',
      }

      const feature = await extractor.extract(input)

      expect(feature.keywords).toContain('user')
      expect(feature.keywords).toContain('data')
    })

    it('handles short names', async () => {
      const input: EntityInput = {
        type: 'function',
        name: 'fn',
        filePath: 'test.ts',
      }

      const feature = await extractor.extract(input)

      expect(feature.description).toBeDefined()
    })
  })
})
