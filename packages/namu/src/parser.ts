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
let initPromise: Promise<void> | undefined
let availabilityProbe: boolean | undefined

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
  // Guard with a shared promise so concurrent callers (e.g. Promise.all over
  // multiple languages) apply the cache-dir config exactly once.
  if (!initPromise) {
    initPromise = (async () => {
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
    })()
  }
  await initPromise
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
    if (!tree)
      throw new Error('tree-sitter parse returned no tree')
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
 *
 * Performs a memoized probe by confirming the native binding exported
 * `getParser` as a callable — the minimal signal that the NAPI module loaded
 * successfully. A failed import throws synchronously at module-load time (e.g.
 * on musl hosts with no matching `.node` prebuild), so that class of failure
 * surfaces before this function is reachable; the try/catch here handles any
 * unexpected runtime errors from the binding introspection itself.
 *
 * Note: `hasLanguage('typescript')` is intentionally NOT used here — it checks
 * whether a grammar is available in the registry (which depends on download
 * state), not whether the native binding itself is functional. Using it would
 * permanently cache `false` if called before grammars are fetched, incorrectly
 * disabling the backend for the lifetime of the process.
 */
export function isAvailable(): boolean {
  if (availabilityProbe === undefined) {
    try {
      availabilityProbe = typeof getParser === 'function'
    }
    catch {
      availabilityProbe = false
    }
  }
  return availabilityProbe
}
