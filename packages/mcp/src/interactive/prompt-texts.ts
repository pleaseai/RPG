/**
 * Instruction prompt constants for the interactive encoding protocol.
 *
 * Adapted from rpg-encoder domain prompts for agent-driven semantic analysis.
 */

export const SEMANTIC_PARSING_INSTRUCTIONS = `## Semantic Feature Extraction

For each code entity below, extract its **semantic features** — what the entity does, not how.

### Rules
1. Use verb+object format: "parse CLI arguments", "validate user credentials"
2. Each feature should be an atomic responsibility — one verb, one object
3. Extract 1-5 features per entity depending on complexity
4. Focus on PURPOSE and BEHAVIOR, not implementation details
5. Avoid language-specific terms (no "async", "decorator", "middleware")
6. Lowercase, no punctuation at the end

### Output Format
Return a JSON object mapping entity IDs to feature arrays:
\`\`\`json
{
  "src/cli.ts:function:main:1": ["parse CLI arguments", "dispatch subcommands"],
  "src/graph/rpg.ts:class:RepositoryPlanningGraph:85": ["store graph nodes and edges", "serialize graph to JSON"]
}
\`\`\``

export const DOMAIN_DISCOVERY_INSTRUCTIONS = `## Domain Discovery

Analyze the file-level features below and identify **functional areas** — broad, cohesive domains of responsibility.

### Rules
1. Think architecturally — identify broad functional domains, not individual files
2. Each area should represent a cohesive set of responsibilities
3. Use PascalCase (e.g., "GraphStorage", "SemanticAnalysis")
4. Aim for 3-8 areas depending on repository size
5. Avoid mapping 1:1 to directories — reorganize semantically
6. Exclude test/docs/vendor directories

### Output Format
Return a JSON array of functional area names:
\`\`\`json
["DataProcessing", "UserInterface", "Authentication", "Configuration"]
\`\`\``

export const HIERARCHY_ASSIGNMENT_INSTRUCTIONS = `## Hierarchy Assignment

Assign each file to a **3-level semantic hierarchy path**: \`<Area>/<category>/<subcategory>\`

### Rules
1. Level 1: Functional area (PascalCase) from domain discovery
2. Level 2: Category — lowercase verb+object (e.g., "pipeline orchestration")
3. Level 3: Subcategory — lowercase verb+object (e.g., "task scheduling")
4. Each level represents a single responsibility
5. Names should be descriptive and semantic, not mirror directory names
6. Every file must be assigned to a path

### Output Format
Return a JSON object mapping file paths to hierarchy paths:
\`\`\`json
{
  "src/encoder/encoder.ts": "SemanticAnalysis/code encoding/repository extraction",
  "src/graph/rpg.ts": "GraphStorage/graph management/node operations"
}
\`\`\``

export const ROUTING_INSTRUCTIONS = `## Entity Routing

For each entity below, decide whether it should be **re-routed** to a different location in the hierarchy.

### Context
Each entity has:
- Current hierarchy path
- Semantic features
- Similarity scores to nearby hierarchy nodes

### Decision Rules
1. **keep**: Entity fits its current location well (similarity > 0.7)
2. **move**: Entity is misplaced and should be moved to a suggested path
3. **split**: Entity has multiple responsibilities that belong in different areas

### Output Format
Return a JSON array of routing decisions:
\`\`\`json
[
  { "entityId": "src/foo.ts:file", "decision": "keep" },
  { "entityId": "src/bar.ts:file", "decision": "move", "targetPath": "DataProcessing/pipeline/scheduling" }
]
\`\`\``

export const FILE_SYNTHESIS_INSTRUCTIONS = `## File-Level Feature Synthesis

Synthesize a **holistic file-level feature description** from the individual entity features within each file.

### Rules
1. Produce one primary description (verb+object) that captures the file's main purpose
2. Produce 3-7 keywords for search
3. The description should abstract ABOVE individual function/class features
4. Think about the file's role in the broader system

### Output Format
Return a JSON object mapping file paths to synthesized features:
\`\`\`json
{
  "src/encoder/encoder.ts": {
    "description": "encode repository codebases into planning graphs",
    "keywords": ["encoder", "rpg", "ast", "semantic", "extraction"]
  }
}
\`\`\``

export const ENCODING_WORKFLOW_INSTRUCTIONS = `# Interactive RPG Encoding Workflow

You are encoding a repository into a Repository Planning Graph (RPG) — a semantic index that maps code structure to functional features.

## Workflow Steps

### Step 1: Build Structural Index
Call \`rpg_build_index\` to parse the repository's AST and create the structural graph (files, functions, classes, dependencies). No semantic features yet.

### Step 2: Semantic Lifting (Batch Processing)
Read entity batches from \`rpg://encoding/entities/*/0\`, \`rpg://encoding/entities/*/1\`, etc.
For each batch:
1. Analyze the source code provided
2. Extract semantic features following the instructions in batch 0
3. Submit features via \`rpg_submit_features\`
4. Continue to the next batch until all entities are covered

### Step 3: Finalize Features
Call \`rpg_finalize_features\` to aggregate entity features into file-level descriptions and auto-route any drifted entities.

### Step 4: File-Level Synthesis
Read \`rpg://encoding/synthesis/0\` and subsequent batches.
For each batch:
1. Review file-level entity features
2. Synthesize holistic file descriptions
3. Submit via \`rpg_submit_synthesis\`

### Step 5: Hierarchy Construction
Read \`rpg://encoding/hierarchy\` for the file features and domain discovery instructions.
1. Identify functional areas
2. Assign each file to a 3-level hierarchy path
3. Submit via \`rpg_submit_hierarchy\`

### Step 6: Routing (if needed)
If entities were flagged for routing during Step 3:
1. Read \`rpg://encoding/routing/0\` for candidates
2. Decide keep/move/split for each
3. Submit via \`rpg_submit_routing\`

### Step 7: Verify
Use \`rpg_search\` and \`rpg_stats\` to verify the resulting RPG.

## Progress Tracking
Read \`rpg://encoding/status\` at any time to check coverage and next steps.`
