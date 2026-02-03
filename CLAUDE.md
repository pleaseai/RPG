# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RPG (Repository Planning Graph) is a TypeScript/Bun implementation of two research papers:
- **RPG-ZeroRepo**: Repository generation from specifications (Intent → Code)
- **RPG-Encoder**: Repository understanding via graph encoding (Code → Intent)

The core data structure is the **Repository Planning Graph (RPG)** - a hierarchical dual-view graph combining semantic features with structural metadata.

## Build & Development Commands

```bash
# Install dependencies
bun install

# Run in development mode (with watch)
bun run dev

# Build for production
bun run build

# Run all tests
bun run test

# Run single test file
bun run test tests/graph.test.ts

# Run specific test by name
bun run test -t "should create node"

# Watch mode for tests
bun run test:watch

# Test UI (browser-based)
bun run test:ui

# Test with coverage
bun run test:coverage

# Lint
bun run lint

# Lint and auto-fix
bun run lint:fix

# Format code
bun run format

# Type checking
bun run typecheck

# CLI (development)
bun run src/cli.ts encode ./my_project
```

## Architecture

### Core Concepts

**RPG Graph Structure** `G = (V, E)`:
- **Nodes (V)**: Each node contains `{ feature, metadata }` where feature = semantic description, metadata = code entity info
  - `HighLevelNode`: Architectural directories/modules
  - `LowLevelNode`: Atomic implementations (files, classes, functions)
- **Edges (E)**:
  - `FunctionalEdge`: Feature hierarchy (parent-child relationships)
  - `DependencyEdge`: Import/call relationships via AST analysis

### Module Responsibilities

| Module | Purpose |
|--------|---------|
| `src/graph/` | RPG data structures (Node, Edge, RepositoryPlanningGraph) using graphology |
| `src/encoder/` | Code → RPG extraction (semantic lifting, structural reorganization, artifact grounding) |
| `src/zerorepo/` | Intent → Code generation (proposal construction, implementation planning, code generation) |
| `src/tools/` | Agentic tools (SearchNode, FetchNode, ExploreRPG) for graph navigation |
| `src/utils/` | AST parser (tree-sitter), LLM interface (OpenAI/Anthropic), Vector DB (LanceDB) |

### Key Pipelines

**ZeroRepo (Generation)**:
1. Proposal-level: Feature tree → explore-exploit selection → goal-aligned refactoring
2. Implementation-level: File structure → data flow → interface design
3. Code generation: Topological traversal with test-driven validation

**Encoder (Understanding)**:
1. Encoding: Semantic lifting → structural reorganization → artifact grounding
2. Evolution: Commit-level incremental updates (add/modify/delete)
3. Operation: SearchNode, FetchNode, ExploreRPG tools

### Key Libraries

- **graphology**: Graph data structure and algorithms
- **tree-sitter**: AST parsing for multiple languages
- **lancedb**: Vector DB for semantic search (Bun-native, disk-based)
- **zod**: Schema validation for graph data
- **commander**: CLI framework
- **vitest**: Testing framework (Jest-compatible, for MCP compatibility)

## Reference Papers

- RPG-ZeroRepo: https://arxiv.org/abs/2509.16198
- RPG-Encoder: https://arxiv.org/abs/2602.02084
- Paper source files in `docs/arXiv-*/` for implementation details

## MCP Server

RPG provides an MCP (Model Context Protocol) server for Claude Code integration.

### Running the MCP Server

```bash
# Development mode
bun run mcp <rpg-file.json>

# Example with sample fixture
bun run mcp tests/fixtures/sample-rpg.json
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `rpg_search` | Semantic code search by features or file patterns |
| `rpg_fetch` | Retrieve entity details, source code, and feature paths |
| `rpg_explore` | Traverse the graph along functional/dependency edges |
| `rpg_encode` | Convert a repository into an RPG |
| `rpg_stats` | Get graph statistics (node/edge counts) |

### Claude Code Configuration

Add to your Claude Code settings (`.claude/settings.json` or `~/.config/claude/settings.json`):

```json
{
  "mcpServers": {
    "rpg": {
      "command": "bun",
      "args": ["run", "/path/to/rpg/src/mcp/server.ts", "/path/to/rpg-file.json"],
      "env": {}
    }
  }
}
```

Or with the installed package:

```json
{
  "mcpServers": {
    "rpg": {
      "command": "rpg-mcp",
      "args": ["/path/to/rpg-file.json"]
    }
  }
}
```

## Design Decisions

- **Vitest over Bun Test**: Jest compatibility for planned MCP server development
- **LanceDB over ChromaDB**: No external server required, Bun-native, disk-based persistence
- **Paper-based implementation**: Original implementation based on research papers, not forked from Microsoft code
