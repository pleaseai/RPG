import type { LanguageConfig, SupportedLanguage } from '../types'
import { goConfig } from './go'
import { javaConfig } from './java'
import { pythonConfig } from './python'
import { rustConfig } from './rust'
import { javascriptConfig, typescriptConfig } from './typescript'

/**
 * Language configurations for all supported languages
 * Maps language names to their AST parsing configurations
 */
export const LANGUAGE_CONFIGS: Record<SupportedLanguage, LanguageConfig> = {
  typescript: typescriptConfig,
  javascript: javascriptConfig,
  python: pythonConfig,
  rust: rustConfig,
  go: goConfig,
  java: javaConfig,
} as const

export { goConfig } from './go'
export { javaConfig } from './java'
export { pythonConfig } from './python'
export { rustConfig } from './rust'
export { javascriptConfig, typescriptConfig } from './typescript'
