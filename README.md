# RPG: Repository Planning Graph

A unified framework for repository understanding and generation based on the Repository Planning Graph (RPG) representation.

[![codecov](https://codecov.io/gh/pleaseai/rpg/graph/badge.svg?token=PfprF4qUBw)](https://codecov.io/gh/pleaseai/rpg)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_rpg&metric=security_rating&token=689e64c38ea80939aaaa4089f723cfc1f879d9c1)](https://sonarcloud.io/summary/new_code?id=pleaseai_rpg)
[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_rpg&metric=vulnerabilities&token=689e64c38ea80939aaaa4089f723cfc1f879d9c1)](https://sonarcloud.io/summary/new_code?id=pleaseai_rpg)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_rpg&metric=bugs&token=689e64c38ea80939aaaa4089f723cfc1f879d9c1)](https://sonarcloud.io/summary/new_code?id=pleaseai_rpg)

## Overview

This project implements the concepts from two research papers:

1. **RPG-ZeroRepo** ([arXiv:2509.16198](https://arxiv.org/abs/2509.16198)) - Repository generation from scratch using structured planning graphs
2. **RPG-Encoder** ([arXiv:2602.02084](https://arxiv.org/abs/2602.02084)) - Encoding existing repositories into RPG for understanding and navigation

### Key Insight

Repository comprehension and generation are inverse processes within a unified reasoning cycle:
- **Generation**: Expands intent into implementation (Intent → Code)
- **Comprehension**: Compresses implementation back into intent (Code → Intent)

RPG serves as a **unified intermediate representation** that bridges both directions.

## Architecture

### Repository Planning Graph (RPG) Structure

RPG is a hierarchical, dual-view graph `G = (V, E)`:

```
                    ┌─────────────────────────────────────────┐
                    │           Repository Planning Graph      │
                    └─────────────────────────────────────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
                    │                                       │
              ┌─────▼─────┐                         ┌───────▼──────┐
              │  Nodes (V) │                         │  Edges (E)   │
              └─────┬─────┘                         └───────┬──────┘
                    │                                       │
        ┌───────────┴───────────┐               ┌───────────┴───────────┐
        │                       │               │                       │
  ┌─────▼─────┐          ┌──────▼─────┐   ┌─────▼─────┐          ┌──────▼─────┐
  │ High-level │          │ Low-level  │   │ Functional │          │ Dependency │
  │   Nodes    │          │   Nodes    │   │   Edges    │          │   Edges    │
  │  (V_H)     │          │   (V_L)    │   │ (E_feature)│          │  (E_dep)   │
  └────────────┘          └────────────┘   └────────────┘          └────────────┘
        │                       │                 │                       │
  Architectural           Atomic            Teleological            Logical
  directories          implementations        hierarchy           interactions
                      (files, classes,                           (imports, calls)
                       functions)
```

### Node Structure

Each node `v = (f, m)` contains:
- **f (Semantic Feature)**: Describes functionality (e.g., "handles authentication")
- **m (Structural Metadata)**: Code entity attributes (type, path, etc.)

### Dual-View Edges

1. **Functional Edges (E_feature)**: Parent-child relationships establishing feature hierarchy
2. **Dependency Edges (E_dep)**: Import/call relationships mapping execution logic

## Components

### 1. RPG-ZeroRepo: Repository Generation

Generate repositories from high-level specifications through three stages:

| Stage | Description |
|-------|-------------|
| **A. Proposal-Level** | Feature Tree → Explore-Exploit Selection → Goal-Aligned Refactoring |
| **B. Implementation-Level** | File Structure → Data Flow → Interface Design |
| **C. Code Generation** | Topological Traversal → TDD → Validation Pipeline |

### 2. RPG-Encoder: Repository Understanding

Extract RPG from existing codebases through three mechanisms:

| Mechanism | Description |
|-----------|-------------|
| **Encoding** | Semantic Lifting → Structural Reorganization → Artifact Grounding |
| **Evolution** | Commit-Level Incremental Updates (Add/Modify/Delete) |
| **Operation** | SearchNode, FetchNode, ExploreRPG Tools |

## Installation

```bash
# Install Bun (if not installed)
curl -fsSL https://bun.sh/install | bash

# Clone and install
git clone https://github.com/pleaseai/rpg.git
cd rpg
bun install
```

## Quick Start

### Repository Generation (ZeroRepo)

```typescript
import { ZeroRepo } from 'rpg-graph'

// Initialize with repository specification
const zerorepo = new ZeroRepo({
  spec: `A machine learning library with data preprocessing,
         algorithms (regression, classification, clustering),
         and evaluation metrics.`
})

// Stage A: Build functionality graph
const funcGraph = await zerorepo.buildProposalGraph()

// Stage B: Add implementation details
const rpg = await zerorepo.buildImplementationGraph(funcGraph)

// Stage C: Generate code
await zerorepo.generateRepository(rpg, './generated_repo')
```

### Repository Understanding (Encoder)

```typescript
import { RPGEncoder, SearchNode, FetchNode, ExploreRPG } from 'rpg-graph'

// Encode existing repository
const encoder = new RPGEncoder('./my_project')
const rpg = await encoder.encode()

// Use agentic tools for navigation
const search = new SearchNode(rpg)
const results = await search.query({
  mode: 'features',
  featureTerms: ['handle authentication', 'validate token']
})

// Fetch detailed information
const fetch = new FetchNode(rpg)
const details = await fetch.get({
  codeEntities: ['auth/login.ts:LoginHandler']
})

// Explore dependencies
const explore = new ExploreRPG(rpg)
const deps = await explore.traverse({
  startNode: 'auth/login.ts:LoginHandler',
  edgeType: 'dependency'
})
```

### Incremental Updates

```typescript
// Update RPG with new commits
await encoder.evolve({ commitRange: 'HEAD~5..HEAD' })
```

### CLI Usage

```bash
# Encode a repository
rpg encode ./my_project -o rpg.json

# Generate from specification
rpg generate --spec "A REST API for user management" -o ./output

# Search in RPG
rpg search --rpg rpg.json --term "authentication"

# Evolve with commits
rpg evolve --rpg rpg.json --commits HEAD~5..HEAD
```

## Project Structure

```
rpg/
├── src/
│   ├── index.ts              # Main exports
│   ├── cli.ts                # CLI entry point
│   │
│   ├── graph/                # RPG data structures
│   │   ├── index.ts
│   │   ├── node.ts           # Node types (HighLevel, LowLevel)
│   │   ├── edge.ts           # Edge types (Functional, Dependency)
│   │   └── rpg.ts            # RepositoryPlanningGraph class
│   │
│   ├── encoder/              # Code → RPG extraction
│   │   ├── index.ts
│   │   ├── semantic.ts       # Semantic lifting
│   │   ├── structure.ts      # Structural reorganization
│   │   ├── grounding.ts      # Artifact grounding
│   │   └── evolution.ts      # Incremental updates
│   │
│   ├── zerorepo/             # Intent → Code generation
│   │   ├── index.ts
│   │   ├── proposal.ts       # Proposal-level construction
│   │   ├── implementation.ts # Implementation-level construction
│   │   └── codegen.ts        # Code generation
│   │
│   ├── tools/                # Agentic operation tools
│   │   ├── index.ts
│   │   ├── search.ts         # SearchNode
│   │   ├── fetch.ts          # FetchNode
│   │   └── explore.ts        # ExploreRPG
│   │
│   └── utils/                # Utilities
│       ├── index.ts
│       ├── ast.ts            # AST analysis (tree-sitter)
│       ├── llm.ts            # LLM interface (OpenAI/Anthropic)
│       └── vector.ts         # Vector database (LanceDB)
│
├── tests/
├── docs/
├── package.json
├── tsconfig.json
├── biome.json
└── README.md
```

## Benchmarks

### Repository Understanding (SWE-bench)

| Method | SWE-bench Verified (Acc@5) | SWE-bench Live Lite |
|--------|---------------------------|---------------------|
| API Documentation | 82.1% | - |
| Dependency Graph | 79.3% | - |
| **RPG-Encoder** | **93.7%** | **+10%** over best baseline |

### Repository Generation (RepoCraft)

| Method | Code Lines | Coverage | Test Accuracy |
|--------|-----------|----------|---------------|
| Claude Code | ~9.2K | 54.2% | 33.9% |
| Other Baselines | ~530 | ~15% | ~10% |
| **ZeroRepo** | **~36K** | **81.5%** | **69.7%** |

## Requirements

- Bun 1.0+
- OpenAI or Anthropic API key (for LLM operations)

## Citation

```bibtex
@article{luo2025rpg,
  title={RPG: A Repository Planning Graph for Unified and Scalable Codebase Generation},
  author={Luo, Jane and Zhang, Xin and Liu, Steven and Wu, Jie and others},
  journal={arXiv preprint arXiv:2509.16198},
  year={2025}
}

@article{luo2025rpgencoder,
  title={Closing the Loop: Universal Repository Representation with RPG-Encoder},
  author={Luo, Jane and Yin, Chengyu and Zhang, Xin and others},
  journal={arXiv preprint arXiv:2602.02084},
  year={2025}
}
```

## License

MIT License

## Documentation

- [Implementation Status](docs/implementation-status.md) — Paper vs implementation gap analysis (implemented / not implemented / needs modification)

## Acknowledgments

This implementation is based on research from Microsoft Research Asia.

- [RPG-ZeroRepo Paper](https://arxiv.org/abs/2509.16198)
- [RPG-Encoder Paper](https://arxiv.org/abs/2602.02084)
- [Project Page](https://ayanami2003.github.io/RPG-Encoder/)
- [Original Code](https://github.com/microsoft/RPG-ZeroRepo)
