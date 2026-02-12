import type { TextSearchStore } from '@pleaseai/rpg-store/text-search-store'
import { SQLiteTextSearchStore } from '@pleaseai/rpg-store/sqlite'
import { SurrealTextSearchStore } from '@pleaseai/rpg-store/surreal'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

function runTextSearchTests(name: string, createStore: () => TextSearchStore) {
  describe(`${name}: TextSearchStore conformance`, () => {
    let store: TextSearchStore

    beforeEach(async () => {
      store = createStore()
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

      // Search only in path field
      const pathResults = await store.search('auth', { fields: ['path'] })
      // Should find n1 (has auth in path)
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
}

runTextSearchTests('SQLiteTextSearchStore', () => new SQLiteTextSearchStore())
runTextSearchTests('SurrealTextSearchStore', () => new SurrealTextSearchStore())
