import { defineConfig } from 'tsdown'

// Packages that cannot be bundled: native binaries, ONNX runtime, optional heavy deps
const external = [
  // SQLite: better-sqlite3 is a native addon (Node.js), bun:sqlite is a Bun built-in.
  // Both are kept external so the bundle loads them at runtime from the host environment.
  'better-sqlite3',
  'bun:sqlite',
  '@lancedb/lancedb',
  '@surrealdb/node',
  // Native tree-sitter language pack (NAPI .node binaries, loaded at runtime — cannot bundle)
  '@kreuzberg/tree-sitter-language-pack',
  // HuggingFace transformers + ONNX (loads model files at runtime, cannot bundle)
  '@huggingface/transformers',
  'onnxruntime-node',
  'onnxruntime-common',
  // Native image processing
  'sharp',
  /^@img\//,
  'detect-libc',
  // Externalize packages using dynamic wasm imports (`import('*.wasm?binary')`)
  // that rolldown cannot resolve at build time.
  '@google/gemini-cli-core',
  'tree-sitter-bash',
]

export default defineConfig([
  // Library bundle: packages/soop/dist/src/index.mjs + packages/soop/dist/src/index.d.mts
  // Bundles all @pleaseai/* workspace packages inline (private, not separately published on npm)
  // Their pure-JS transitive deps (ai-sdk, consola, etc.) are also bundled
  // Native/binary deps remain external (consumer must install optionalDependencies)
  {
    entry: { 'src/index': './packages/soop/src/index.ts' },
    format: 'esm',
    platform: 'node',
    dts: { eager: true },
    clean: true,
    outDir: 'packages/soop/dist',
    external,
    noExternal: [/^@pleaseai\//],
    inlineOnly: false,
  },
  // CLI binary: packages/soop/dist/packages/cli/src/cli.mjs (standalone, bundles all pure-JS deps)
  // noExternal ensures @pleaseai/* workspace packages are bundled inline (private, not on npm)
  {
    entry: { 'packages/cli/src/cli': './packages/cli/src/cli.ts' },
    format: 'esm',
    platform: 'node',
    dts: false,
    outDir: 'packages/soop/dist',
    external,
    noExternal: [/^@pleaseai\//],
    inlineOnly: false,
  },
  // Launcher script: compiled from scripts/launcher/cli.ts → packages/soop-native/dist/launcher-cli.mjs
  // Pure Node.js script (no native deps) used by bin/soop shim in soop-native
  {
    entry: {
      'launcher-cli': './scripts/launcher/cli.ts',
    },
    format: 'esm',
    platform: 'node',
    dts: false,
    outDir: 'packages/soop-native/dist',
    // Launchers have no @pleaseai/* deps — they only use Node.js built-ins
    inlineOnly: false,
  },
])
