import type { EntityInput } from '@pleaseai/rpg-encoder/semantic'
import { SemanticExtractor } from '@pleaseai/rpg-encoder/semantic'
import { describe, expect, it } from 'vitest'

describe('semanticExtractor', () => {
  const extractor = new SemanticExtractor({ useLLM: false })

  describe('heuristic extraction', () => {
    it('extracts semantic features for function', async () => {
      const input: EntityInput = {
        type: 'function',
        name: 'validateUserInput',
        filePath: 'packages/utils/src/validation.ts',
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

      expect(feature.description).toContain('define')
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
        filePath: 'packages/encoder/src/encoder.ts',
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
        { name: 'handleError', expected: 'dispatch' },
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
      expect(features[2].description).toContain('define')
    })
  })

  describe('feature naming validation', () => {
    it('passes valid names through unchanged', () => {
      const result = extractor.validateFeatureName('validate user input')
      expect(result.description).toBe('validate user input')
      expect(result.subFeatures).toBeUndefined()
    })

    it('normalizes to lowercase', () => {
      const result = extractor.validateFeatureName('Validate User Input')
      expect(result.description).toBe('validate user input')
    })

    it('detects and replaces vague verbs', () => {
      const result = extractor.validateFeatureName('handle user authentication')
      expect(result.description).toBe('dispatch user authentication')
    })

    it('replaces process with transform', () => {
      const result = extractor.validateFeatureName('process incoming data')
      expect(result.description).toBe('transform incoming data')
    })

    it('truncates descriptions longer than 8 words', () => {
      const result = extractor.validateFeatureName(
        'validate and transform user input data from external api source',
      )
      // "and" splits, then first part is "validate", second part is "transform user input data from external api source"
      // First part: "validate" (1 word), second part: "transform user..." (8 words)
      // Split only happens if before has >=2 words, so no split here — truncation applies
      expect(result.description.split(/\s+/).length).toBeLessThanOrEqual(8)
    })

    it('keeps short descriptions as-is', () => {
      const result = extractor.validateFeatureName('load config')
      expect(result.description).toBe('load config')
    })

    it('removes trailing punctuation', () => {
      const result = extractor.validateFeatureName('validate user input.')
      expect(result.description).toBe('validate user input')
    })

    it('removes semicolons and commas', () => {
      const result = extractor.validateFeatureName('send http request;')
      expect(result.description).toBe('send http request')
    })

    it('splits "and" into description + subFeatures', () => {
      const result = extractor.validateFeatureName('initialize config and register globally')
      expect(result.description).toBe('initialize config')
      expect(result.subFeatures).toEqual(['register globally'])
    })

    it('does not split "and" when first part is too short', () => {
      const result = extractor.validateFeatureName('load and save data')
      // "load" is only 1 word (< 2), so no split
      expect(result.subFeatures).toBeUndefined()
      expect(result.description).toContain('load')
    })

    it('splits multiple "and" into multiple subFeatures', () => {
      const result = extractor.validateFeatureName(
        'validate input and normalize data and save result',
      )
      expect(result.description).toBe('validate input')
      expect(result.subFeatures).toEqual(['normalize data', 'save result'])
    })

    it('applies vague verb replacement to subFeatures', () => {
      const result = extractor.validateFeatureName('initialize config and handle errors')
      expect(result.description).toBe('initialize config')
      expect(result.subFeatures).toEqual(['dispatch errors'])
    })

    it('does not split "and" when rest is not a verb phrase', () => {
      const result = extractor.validateFeatureName('manage users and their permissions')
      // "their permissions" is not a verb phrase, so no split — full text kept
      expect(result.subFeatures).toBeUndefined()
      expect(result.description).toBe('coordinate users and their permissions')
    })

    it('strips implementation detail keywords', () => {
      const result = extractor.validateFeatureName('iterate array to find user')
      // "iterate" and "array" are stripped
      expect(result.description).not.toContain('iterate')
      expect(result.description).not.toContain('array')
      expect(result.description).toContain('find')
      expect(result.description).toContain('user')
    })
  })

  describe('file-level aggregation', () => {
    it('aggregates multiple child features into summary', async () => {
      const childFeatures = [
        { description: 'validate user input', keywords: ['validate', 'user'] },
        { description: 'validate email format', keywords: ['validate', 'email'] },
      ]

      const result = await extractor.aggregateFileFeatures(
        childFeatures,
        'validation',
        'src/validation.ts',
      )

      expect(result.description).toBeDefined()
      expect(result.description.length).toBeGreaterThan(0)
      expect(result.keywords).toBeDefined()
      expect(result.keywords.length).toBeGreaterThan(0)
    })

    it('uses heuristic aggregation with most common verb', async () => {
      const childFeatures = [
        { description: 'create user account', keywords: ['create', 'user'] },
        { description: 'create admin role', keywords: ['create', 'admin'] },
        { description: 'delete user account', keywords: ['delete', 'user'] },
      ]

      const result = await extractor.aggregateFileFeatures(
        childFeatures,
        'accounts',
        'src/accounts.ts',
      )

      // "create" is the most common verb (2 out of 3)
      expect(result.description).toContain('create')
      expect(result.description).toContain('accounts')
    })

    it('merges and deduplicates keywords', async () => {
      const childFeatures = [
        { description: 'load config', keywords: ['load', 'config'] },
        { description: 'save config', keywords: ['save', 'config'] },
      ]

      const result = await extractor.aggregateFileFeatures(childFeatures, 'config', 'src/config.ts')

      expect(result.keywords).toContain('config')
      expect(result.keywords).toContain('load')
      expect(result.keywords).toContain('save')
      // No duplicates
      const unique = new Set(result.keywords)
      expect(unique.size).toBe(result.keywords.length)
    })

    it('falls back to file name for empty child features', async () => {
      const result = await extractor.aggregateFileFeatures([], 'utils', 'src/utils.ts')

      expect(result.description).toContain('utils')
      expect(result.keywords).toContain('utils')
    })

    it('includes child descriptions as subFeatures for multi-entity files', async () => {
      const childFeatures = [
        { description: 'parse json input', keywords: ['parse'] },
        { description: 'format output data', keywords: ['format'] },
      ]

      const result = await extractor.aggregateFileFeatures(
        childFeatures,
        'transformer',
        'src/transformer.ts',
      )

      // Heuristic mode includes child descriptions as sub-features when >1 child
      expect(result.subFeatures).toBeDefined()
      expect(result.subFeatures!.length).toBeGreaterThan(0)
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
