import type { NamuLanguage, NamuParser, NamuTree, SupportedLanguage } from './types'

import { getParser, hasLanguage } from '@kreuzberg/tree-sitter-language-pack'
import { wrapTree } from './adapter'
import { toNativeLanguageName } from './languages'

/**
 * Native tree-sitter backend built on @kreuzberg/tree-sitter-language-pack.
 *
 * Replaces the previous web-tree-sitter WASM pipeline. Grammars ship as
 * prebuilt native (NAPI) binaries — no emcc/Docker build step. The public
 * surface (`createParser` / `getLanguage` / `initNamu` / `isAvailable`) is
 * preserved so `@pleaseai/soop-ast` and `@pleaseai/soop-encoder` are unaffected;
 * raw nodes are bridged to the `NamuNode` interface by the adapter.
 */

/** A `NamuLanguage` handle carrying the resolved native language name. */
interface NativeLanguageHandle extends NamuLanguage {
  readonly __name: string
}

let initialized = false

/**
 * One-time backend init (idempotent). The native pack resolves and caches
 * parsers lazily on first `getParser()`; cache configuration is layered on in a
 * later task. Kept async to preserve the existing call signature.
 */
export async function initNamu(): Promise<void> {
  if (initialized)
    return
  initialized = true
}

class NativeParser implements NamuParser {
  private native: { parse: (input: string) => unknown } | null = null

  setLanguage(language: NamuLanguage | null): void {
    const name = (language as NativeLanguageHandle | null)?.__name ?? null
    this.native = name ? (getParser(name) as { parse: (input: string) => unknown }) : null
  }

  parse(input: string): NamuTree {
    if (!this.native)
      throw new Error('NamuParser.parse called before setLanguage')
    const tree = this.native.parse(input)
    return wrapTree(tree as Parameters<typeof wrapTree>[0], input)
  }

  delete(): void {
    this.native = null
  }
}

/**
 * Create a new Parser instance. Bind a language via `setLanguage(getLanguage(...))`
 * before calling `parse()`.
 */
export async function createParser(): Promise<NamuParser> {
  await initNamu()
  return new NativeParser()
}

/**
 * Resolve a language handle by `SupportedLanguage` name. Throws if the native
 * pack does not provide the language.
 */
export async function getLanguage(lang: SupportedLanguage): Promise<NamuLanguage> {
  await initNamu()
  const name = toNativeLanguageName(lang)
  if (!hasLanguage(name))
    throw new Error(`Language not available in tree-sitter-language-pack: ${lang} (${name})`)
  const handle: NativeLanguageHandle = { __name: name, version: 0 }
  return handle
}

/**
 * Check whether the native tree-sitter backend is usable.
 * Returns false if the platform binary failed to load.
 */
export function isAvailable(): boolean {
  return typeof getParser === 'function'
}
