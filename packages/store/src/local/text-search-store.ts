import type { TextSearchStore } from '../text-search-store'
import type { TextSearchOpts, TextSearchResult } from '../types'

interface LocalDoc {
  fields: Record<string, string>
  metadata?: Record<string, unknown>
}

/**
 * LocalTextSearchStore — Zero-dependency, in-memory TextSearchStore.
 *
 * Indexes documents by multiple text fields and performs case-insensitive
 * word matching with term-frequency scoring. No file persistence — rebuilt
 * from graph data each session. Suitable as a better-sqlite3 FTS fallback.
 */
export class LocalTextSearchStore implements TextSearchStore {
  private docs: Map<string, LocalDoc> = new Map()

  async open(_config: unknown): Promise<void> {
    this.docs = new Map()
  }

  async close(): Promise<void> {
    this.docs = new Map()
  }

  async index(
    id: string,
    fields: Record<string, string>,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    this.docs.set(id, { fields, metadata })
  }

  async remove(id: string): Promise<void> {
    this.docs.delete(id)
  }

  async search(query: string, opts?: TextSearchOpts): Promise<TextSearchResult[]> {
    const terms = tokenize(query)
    if (terms.length === 0)
      return []

    const topK = opts?.topK ?? 50
    const fieldFilter = opts?.fields

    const results: TextSearchResult[] = []

    for (const [id, doc] of this.docs) {
      const score = scoreDoc(doc.fields, terms, fieldFilter)
      if (score > 0) {
        results.push({ id, score, fields: doc.fields })
      }
    }

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }

  async indexBatch(docs: Array<{ id: string, fields: Record<string, string> }>): Promise<void> {
    for (const doc of docs) {
      this.docs.set(doc.id, { fields: doc.fields })
    }
  }
}

function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/\w+/g)
  return matches ?? []
}

function scoreDoc(
  fields: Record<string, string>,
  terms: string[],
  fieldFilter?: string[],
): number {
  const fieldEntries = fieldFilter
    ? Object.entries(fields).filter(([k]) => fieldFilter.includes(k))
    : Object.entries(fields)

  let total = 0
  for (const [, value] of fieldEntries) {
    const fieldTokens = tokenize(value)
    if (fieldTokens.length === 0)
      continue
    for (const term of terms) {
      const count = fieldTokens.filter(t => t.startsWith(term)).length
      total += count / fieldTokens.length
    }
  }
  return total
}
