# Code Reviewer Memory

## Project: rpg (soop please)

### Key Conventions
- Logging: `createLogger('Tag')` from `@pleaseai/soop-utils/logger` (consola-based)
- Cross-package imports use `@pleaseai/soop-*` workspace names; intra-package uses relative imports
- Store implementations NOT re-exported from barrel (avoid transitive native module loading)
- Test runner: vitest via `bun run test <file>`; lint: `bun run lint:fix`
- All git messages, code comments, PR descriptions in English

### Review Patterns
- SemanticExtractor defaults `provider: 'google'` with GOOGLE_API_KEY guard that falls back to heuristic mode
- LLMClient.buildProviderOptions() wraps googleSettings under `{ google: ... }` key for ai-sdk providerOptions
- Provider-specific settings (claudeCodeSettings, codexSettings, googleSettings) must be threaded through: encoder.ts -> semantic.ts -> LLMClient
- Default model: `gemini-3.1-flash-lite-preview` for google provider

### Pointers
- [namu native backend](project_namu-native-backend.md) — web-tree-sitter→native NAPI migration; byte-offset .text slicing gotcha (ASCII tests miss non-ASCII bugs)

### Known Pre-existing Test Failures (llm.test.ts)
- claudeCodeSettings tests fail due to extra default settings in createProvider
- structured output null test has error message mismatch
