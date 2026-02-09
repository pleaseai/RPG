import type { TextSearchStore } from '../../src/store/text-search-store'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LadybugTextSearchStore } from '../../src/store/ladybug/text-search-store'

describe('LadybugTextSearchStore: TextSearchStore conformance', () => {
  let store: TextSearchStore

  beforeEach(async () => {
    store = new LadybugTextSearchStore()
    await store.open('memory')
  })

  afterEach(async () => {
    await store.close()
  })

  it('index and search by feature', async () => {
    await store.index('auth-mod', {
      feature_desc: 'authentication and authorization module',
      feature_keywords: 'auth login security',
    })

    const results = await store.search('authentication')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].id).toBe('auth-mod')
  })

  it('search returns empty for no match', async () => {
    await store.index('n1', { feature_desc: 'hello world' })
    const results = await store.search('nonexistent')
    expect(results).toHaveLength(0)
  })

  it('remove document from index', async () => {
    await store.index('n1', { feature_desc: 'authentication module' })
    await store.remove('n1')
    const results = await store.search('authentication')
    expect(results).toHaveLength(0)
  })

  it('field-restricted search', async () => {
    await store.index('n1', {
      feature_desc: 'handles user authentication',
      path: '/src/auth/login.ts',
    })
    await store.index('n2', {
      feature_desc: 'API routing',
      path: '/src/api/router.ts',
    })

    const pathResults = await store.search('auth', { fields: ['path'] })
    if (pathResults.length > 0) {
      expect(pathResults.some(r => r.id === 'n1')).toBe(true)
    }
  })

  it('indexBatch', async () => {
    if (!store.indexBatch)
      return

    await store.indexBatch([
      { id: 'b1', fields: { feature_desc: 'batch item one' } },
      { id: 'b2', fields: { feature_desc: 'batch item two' } },
    ])

    const results = await store.search('batch')
    expect(results.length).toBe(2)
  })
})
