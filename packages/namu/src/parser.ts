import type { NamuLanguage, NamuParser, NamuTree, SupportedLanguage } from './types'

import { configure, download, getParser, hasLanguage } from '@kreuzberg/tree-sitter-language-pack'
import { wrapTree } from './adapter'
import { SUPPORTED_LANGUAGES, toNativeLanguageName } from './languages'

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
 * Environment override for the native pack's parser cache directory.
 *
 * The pack downloads grammars on demand and caches them under a user cache dir
 * (e.g. `~/.cache/tree-sitter-language-pack/v<version>/libs`). Pinning this to a
 * known, cacheable path makes CI and offline runs deterministic.
 */
const CACHE_DIR_ENV = 'SOOP_TS_CACHE_DIR'

/**
 * One-time backend init (idempotent). Applies the cache-dir override (if set)
 * before any parser is resolved. The native pack resolves and caches grammars
 * lazily on first `getParser()`. Kept async to preserve the existing signature.
 */
export async function initNamu(): Promise<void> {
  if (initialized)
    return
  const cacheDir = process.env[CACHE_DIR_ENV]
  if (cacheDir) {
    try {
      configure({ cacheDir })
    }
    catch {
      // Non-fatal: fall back to the pack's default cache location.
    }
  }
  initialized = true
}

/**
 * Best-effort pre-download of grammars for the given languages (defaults to the
 * curated supported set). Useful for CI / offline provisioning. Returns the
 * number of grammars fetched; never throws.
 */
export async function prefetchLanguages(
  langs: readonly SupportedLanguage[] = SUPPORTED_LANGUAGES,
): Promise<number> {
  await initNamu()
  try {
    return download(langs.map(toNativeLanguageName))
  }
  catch {
    return 0
  }
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
