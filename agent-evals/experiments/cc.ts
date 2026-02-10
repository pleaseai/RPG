import type { ExperimentConfig } from '@pleaseai/agent-eval'

const config: ExperimentConfig = {
  agent: 'claude-code',
  runs: 1,
  earlyExit: true,
  scripts: ['build'],
  timeout: 1200,
}

export default config
