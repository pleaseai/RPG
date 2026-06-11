import type { ExperimentConfig } from '@pleaseai/agent-eval'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RPG_FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'nextjs-rpg.json')

const CLAUDE_MD = `# RPG MCP Server

You have access to an RPG (Repository Planning Graph) MCP server pre-loaded with the Next.js codebase.
Use RPG tools to find relevant source files.

## Available Tools

| Tool | When to Use |
|------|-------------|
| rpg_search | Find code entities by feature description or file pattern |
| rpg_fetch | Get detailed metadata, source code, and feature paths for entities |
| rpg_explore | Traverse dependency/containment edges from a starting node |
| rpg_stats | Check graph statistics |

## Workflow

1. **Search by features**: Use \`rpg_search\` with mode "features" to find relevant source files
2. **Verify matches**: Use \`rpg_fetch\` to inspect entity details and confirm relevance
3. **Trace dependencies**: Use \`rpg_explore\` to discover related files via edges

## Example

To find files related to image optimization:
\`\`\`
rpg_search({ mode: "features", feature_terms: ["image", "optimization", "responsive"] })
rpg_fetch({ code_entities: ["<entity-id-from-search>"] })
\`\`\`
`

const config: ExperimentConfig = {
  agent: 'claude-code',
  runs: 1,
  earlyExit: true,
  scripts: [],
  timeout: 300,
  evals: name => name.startsWith('retrieval-'),
  setup: async (sandbox) => {
    const rpgData = readFileSync(RPG_FIXTURE, 'utf-8')
    await sandbox.writeFiles({
      '.claude/settings.json': JSON.stringify({
        mcpServers: {
          rpg: {
            command: 'rpg-mcp',
            args: ['nextjs-rpg.json', '--no-search'],
          },
        },
      }),
      'CLAUDE.md': CLAUDE_MD,
      'nextjs-rpg.json': rpgData,
    })
  },
}

export default config
