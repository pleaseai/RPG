import type { ExperimentConfig } from '@pleaseai/agent-eval'

const config: ExperimentConfig = {
  agent: 'claude-code',
  runs: 1,
  earlyExit: true,
  scripts: [],
  timeout: 300,
  evals: name => name.startsWith('retrieval-'),
}

export default config
