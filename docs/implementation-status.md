# RPG: Paper vs Implementation Status

RPG is a TypeScript/Bun project implementing two research papers:

- **RPG-ZeroRepo** ([arXiv:2509.16198](https://arxiv.org/abs/2509.16198)): Intent → Code generation pipeline
- **RPG-Encoder** ([arXiv:2602.02084](https://arxiv.org/abs/2602.02084)): Code → Intent understanding pipeline

This document compares the current implementation against the papers, categorizing each component as implemented, not implemented, or needs modification.

---

## 1. Implemented

### 1.1 Core Graph Data Structures

- **Node types**: `HighLevelNode`, `LowLevelNode` + Zod schemas — `src/graph/node.ts`
- **Edge types**: `FunctionalEdge`, `DependencyEdge`, `DataFlowEdge` — `src/graph/edge.ts`
- **SemanticFeature / StructuralMetadata**: Faithful implementation of the paper's `v = (f, m)` structure
- **EntityType**: file, class, function, method, module
- **DependencyType**: import, call, inherit, implement, use
- **Factory functions / type guards**: `createHighLevelNode()`, `isHighLevelNode()`, etc.

### 1.2 RepositoryPlanningGraph Class

- Node/Edge CRUD — `src/graph/rpg.ts`
- Graph traversal: `getChildren()`, `getParent()`, `getDependencies()`, `getDependents()`
- **Topological sort**: Kahn's algorithm (`getTopologicalOrder()`) — corresponds to the paper's topological traversal
- Search: `searchByFeature()`, `searchByPath()`
- Serialization/deserialization: `serialize()`, `toJSON()`, `fromJSON()`
- Statistics: `getStats()` (node/edge counts, type distribution)

### 1.3 Storage Layer

| Implementation | Module | Status |
|----------------|--------|--------|
| SQLiteGraphStore + FTS5 | `src/store/sqlite/` | ✅ Complete |
| SurrealGraphStore + BM25 | `src/store/surreal/` | ✅ Complete |
| LanceDBVectorStore | `src/store/lancedb/` | ✅ Complete |
| ContextStore (composite) | `src/store/context-store.ts` | ✅ Complete |
| Legacy SQLiteStore | `src/graph/sqlite-store.ts` | ✅ Backward-compatible |
| Legacy SurrealStore | `src/graph/surreal-store.ts` | ✅ Backward-compatible |

### 1.4 Encoder — Phase 1: Semantic Lifting

- **SemanticExtractor**: LLM-based feature extraction + heuristic fallback — `src/encoder/semantic.ts`
- **LLM provider auto-detection**: Google > Anthropic > OpenAI priority
- **SemanticCache**: 7-day TTL, content hash-based cache — `src/encoder/cache.ts`
- **ASTParser**: TypeScript, JavaScript, Python support — `src/utils/ast.ts`
  - Entity extraction (function, class, method, variable, import)
  - Docstring, parameter, return type, parent entity parsing

### 1.5 Encoder — Phase 2: Structural Reorganization

- **RPGEncoder.encode()**: 3-phase orchestration — `src/encoder/encoder.ts`
  - `discoverFiles()`: Pattern-based source file discovery
  - `extractEntities()`: AST-based entity extraction
  - `buildFunctionalHierarchy()`: LLM-based semantic reorganization (Domain Discovery + 3-Level Path)
  - `injectDependencies()`: Import parsing → DependencyEdge creation

### 1.6 Encoder — Phase 2: Semantic Reorganization (Paper §3.2)

LLM-based semantic reorganization replacing directory-mirroring hierarchy — `src/encoder/reorganization/`

| Paper Component | Module | Status |
|-----------------|--------|--------|
| **Domain Discovery** | `src/encoder/reorganization/domain-discovery.ts` | ✅ Complete |
| **Three-Level Path Construction** | `src/encoder/reorganization/hierarchy-builder.ts` | ✅ Complete |
| **Granularity-based input compression** | `src/encoder/reorganization/prompts.ts` | ✅ Complete |
| **PascalCase functional area naming** | `domain-discovery.ts` | ✅ Complete |
| **Uncategorized fallback** | `hierarchy-builder.ts` | ✅ Complete |
| **Backward compatibility** | `encoder.ts` | ✅ Skips silently without LLM |

### 1.7 Embedding & Semantic Search

- **OpenAIEmbedding**: text-embedding-3-small/large — `src/encoder/embedding.ts`
- **HuggingFaceEmbedding**: MongoDB LEAF local models (768/1024 dim)
- **SemanticSearch**: Hybrid search (vector + BM25) — `src/encoder/semantic-search.ts`
- **cosineSimilarity()** — `src/utils/vector.ts`

### 1.8 Agentic Tools

| Tool | Module | Paper Correspondence |
|------|--------|---------------------|
| SearchNode | `src/tools/search.ts` | RPG-Encoder SearchNode (features/snippets/auto) |
| FetchNode | `src/tools/fetch.ts` | RPG-Encoder FetchNode (metadata + source) |
| ExploreRPG | `src/tools/explore.ts` | RPG-Encoder ExploreRPG (BFS/DFS traversal) |

### 1.9 MCP Server

- 5 tools (rpg_search, rpg_fetch, rpg_explore, rpg_encode, rpg_stats) — `src/mcp/`
- Zod-based input validation, error factory pattern

### 1.10 CLI

- `encode`, `search`, `fetch` commands — `src/cli.ts`

### 1.11 RPG-Encoder: Evolution (Incremental Updates)

Commit-level incremental maintenance — a key differentiator of the paper — implementing the 3 atomic operations from §4:

| Paper Component | Module | Status |
|-----------------|--------|--------|
| **ParseUnitDiff** (Delta-Level Feature Extraction) | `src/encoder/evolution/diff-parser.ts` | ✅ Complete |
| **DeleteNode + PruneOrphans** (Algorithm 1) | `src/encoder/evolution/operations.ts` | ✅ Complete |
| **ProcessModification** with semantic drift (Algorithm 2) | `src/encoder/evolution/operations.ts` | ✅ Complete |
| **InsertNode** with semantic routing (Algorithm 3) | `src/encoder/evolution/operations.ts` | ✅ Complete |
| **FindBestParent** LLM/embedding routing | `src/encoder/evolution/semantic-router.ts` | ✅ Complete |
| **RPGEvolver** orchestrator (Delete → Modify → Insert) | `src/encoder/evolution/evolve.ts` | ✅ Complete |
| **RPGEncoder.evolve()** public API | `src/encoder/encoder.ts` | ✅ Complete |

### 1.12 Tests

- 28 test files (unit + integration)
- Vitest workspace configuration (unit: 10s, integration: 30s)
- Fixtures: `tests/fixtures/superjson/`

---

## 2. Not Implemented

### 2.1 RPG-ZeroRepo: Full Generation Pipeline (skeleton only)

Currently only a skeleton exists at `src/zerorepo/zerorepo.ts`; core logic is not implemented:

| Paper Component | Description | Status |
|-----------------|-------------|--------|
| **Feature Tree Grounding** | Capability mapping based on EpiCoder Feature Tree (1.5M+ capabilities) | ❌ Not implemented |
| **Explore-Exploit Subtree Selection** | Diversity-Aware Rejection Sampling + explore-exploit balance | ❌ Not implemented |
| **Goal-Aligned Refactoring** | LLM-based module reorganization (high cohesion, low coupling) | ❌ Not implemented |
| **File Structure Encoding** | Folder/file level structure encoding | ❌ Not implemented |
| **Data Flow Encoding** | Inter/intra-module data flow definition | ❌ Not implemented |
| **Global Interface Abstraction** | Common base class/interface design | ❌ Not implemented |
| **Adaptive Interface Design** | Auto-decision: independent features → functions, interdependent → classes | ❌ Not implemented |
| **Graph-Guided Code Generation** | Topological order-based TDD code generation | ❌ Not implemented |
| **Test Generation & Validation** | 3-tier test generation (Unit/Regression/Integration) | ❌ Not implemented |
| **Majority-Vote Diagnosis** | Automated test failure root cause diagnosis | ❌ Not implemented |

### 2.2 RPG-Encoder: Advanced Semantic Structure Reorganization

| Paper Component | Description | Status |
|-----------------|-------------|--------|
| **Domain Discovery** | LLM-based automatic functional area identification, PascalCase naming | ✅ Implemented |
| **Three-Level Path Construction** | `<functional area>/<category>/<subcategory>` 3-level hierarchy | ✅ Implemented |
| **Semantic Compatibility Routing** | LLM places nodes under semantically optimal parents | ❌ Not implemented |

### 2.3 RPG-Encoder: Advanced Artifact Grounding

| Paper Component | Description | Status |
|-----------------|-------------|--------|
| **LCA-Based Metadata Propagation** | Trie-based bottom-up path propagation using Lowest Common Ancestor | ❌ Not implemented |
| **Abstract → Physical Mapping** | Anchoring abstract features to code paths | ❌ Not implemented |

### 2.4 RepoCraft Benchmark

- Paper's evaluation framework (6 projects, 1,052 tasks) not implemented

### 2.5 Localization & Editing Tools

- `view_file_interface_feature_map`, `get_interface_content`, `expand_leaf_node_info`, `search_interface_by_functionality` — editing tools from the ZeroRepo paper

---

## 3. Needs Modification

### 3.1 Semantic Lifting Improvements

| Item | Current | Paper Requirement | Status |
|------|---------|-------------------|--------|
| Feature naming rules | verb + object format, 3-8 words | verb + object format, single responsibility, exclude implementation details | ✅ Implemented (PR #29) |
| File-level aggregation | Function features → file summary | Synthesize function-level features → file-level summary | ✅ Implemented (PR #29) |
| Functional edge auto-generation | file → function edges in Phase 1 | Auto-generate functional edges between file → function | ✅ Implemented |

### 3.2 Structural Reorganization Improvements

| Item | Current | Paper Requirement | Status |
|------|---------|-------------------|--------|
| Hierarchy structure | LLM-based Domain Discovery + 3-Level Path | Semantic-based reorganization (resolve structural entanglement) | ✅ Implemented |
| HighLevelNode creation | `domain:` prefixed semantic nodes | LLM-based functional area identification then reorganization | ✅ Implemented |

### 3.3 SearchNode Tool Improvements

| Item | Current | Paper Requirement | Suggested Fix |
|------|---------|-------------------|---------------|
| search_scopes | Not supported | Restrict search scope to selected feature subtree | Add scopes parameter to SearchOptions |
| auto mode | Simple fallback | Staged fallback: feature → snippet + high-signal identifier usage | Implement paper's tool orchestration policy |

### 3.4 ExploreRPG Tool Improvements

| Item | Current | Paper Requirement | Suggested Fix |
|------|---------|-------------------|---------------|
| Containment relations | Not supported | Traverse dependency + containment/composition relations | Add containment traversal |
| Directionality | in/out/both | Explicit upstream/downstream distinction | Align with paper terminology |

### 3.5 MCP Tool Expansion

| Item | Current | Needed |
|------|---------|--------|
| rpg_evolve | Does not exist | MCP wrapper for `RPGEvolver` (backend implemented) |
| rpg_generate | Does not exist | ZeroRepo generation pipeline tool |
| Tool orchestration | Independent calls | Paper's Search → Fetch → Explore workflow guide |

### 3.6 DataFlowEdge Usage

| Item | Current | Paper Requirement | Suggested Fix |
|------|---------|-------------------|---------------|
| DataFlowEdge | Type definition only | Inter/intra-module data flow encoding | Implement DataFlowEdge creation logic in Encoder |

### 3.7 Language Support Expansion

| Item | Current | Notes |
|------|---------|-------|
| AST parser | TypeScript, JavaScript, Python | Paper evaluation is Python-centric; add tree-sitter bindings as needed for additional languages |

---

## 4. Suggested Implementation Priority

```
P0 (Core)
├── ✅ RPG-Encoder Evolution (incremental updates) — key paper differentiator, 95.7% cost reduction
├── ✅ Domain Discovery + 3-Level Path (semantic reorganization)
├── Semantic Lifting improvements (naming rules, file-level aggregation)
└── Semantic Compatibility Routing (LLM-based node placement)

P1 (Important)
├── Artifact Grounding — LCA-based metadata propagation
├── SearchNode search_scopes support
├── MCP rpg_evolve tool
└── DataFlowEdge usage

P2 (Generation Pipeline)
├── ZeroRepo Stage 1 — Feature Tree + Explore-Exploit
├── ZeroRepo Stage 2 — File Structure + Interface Design
├── ZeroRepo Stage 3 — Graph-Guided Code Generation
└── Test Generation & Validation

P3 (Benchmarks/Evaluation)
├── RepoCraft benchmark implementation
└── SWE-bench evaluation integration
```
