import type { SupportedLanguage } from './types'

/**
 * Languages with tuned extraction support in `@pleaseai/soop-ast`.
 *
 * All values map identically to @kreuzberg/tree-sitter-language-pack language
 * names (verified: `typescript`, `javascript`, `python`, `rust`, `go`, `java`,
 * `csharp`, `c`, `cpp`, `ruby`, `kotlin` are all valid pack names). The pack
 * supports 300+ languages; tuned extraction stays at this curated set.
 */
const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = [
  'typescript',
  'javascript',
  'python',
  'rust',
  'go',
  'java',
  'csharp',
  'c',
  'cpp',
  'ruby',
  'kotlin',
]

/**
 * Map a `SupportedLanguage` to its native tree-sitter-language-pack name.
 * Currently an identity mapping; centralized so aliases can be added later.
 */
export function toNativeLanguageName(lang: SupportedLanguage): string {
  return lang
}

export { SUPPORTED_LANGUAGES }
