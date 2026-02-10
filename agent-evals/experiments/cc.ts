import type { ExperimentConfig } from '@vercel/agent-eval'

const config: ExperimentConfig = {
  agent: 'claude-code',
  runs: 1,
  earlyExit: true,
  scripts: ['build'],
  timeout: 1200,
  setup: async (sandbox) => {
    await sandbox.writeFiles({
      '.claude/settings.json': JSON.stringify({
        mcpServers: { rpg: { command: 'npx @pleaseai/rpg' } },
      }),
    })
  },
}

export default config
