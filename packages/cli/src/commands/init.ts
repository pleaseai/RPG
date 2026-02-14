import type { Command } from 'commander'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createLogger } from '@pleaseai/rpg-utils/logger'

const log = createLogger('init')

export interface RPGProjectConfig {
  include?: string[]
  exclude?: string[]
  model?: string
  useLLM?: boolean
  embedding?: {
    provider: string
    model: string
    dimension: number
    space?: string
  }
}

const DEFAULT_CONFIG: RPGProjectConfig = {
  include: ['**/*.ts', '**/*.js', '**/*.py', '**/*.rs', '**/*.go', '**/*.java'],
  exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize RPG in a repository')
    .argument('[path]', 'Repository path', '.')
    .option('--hooks', 'Install git hooks (post-merge, post-checkout)')
    .option('--ci', 'Generate GitHub Actions workflow file')
    .option('--encode', 'Run initial full encode immediately')
    .option('--embed', 'Include embedding configuration (voyage-ai/voyage-code-3)')
    .action(
      async (
        repoPath: string,
        options: {
          hooks?: boolean
          ci?: boolean
          encode?: boolean
          embed?: boolean
        },
      ) => {
        try {
          const absPath = path.resolve(repoPath)

          // 1. Create .rpg/ directory structure
          const rpgDir = path.join(absPath, '.rpg')
          const localDir = path.join(rpgDir, 'local')

          if (existsSync(path.join(rpgDir, 'config.json'))) {
            log.warn('.rpg/config.json already exists, skipping config creation')
          }
          else {
            await mkdir(rpgDir, { recursive: true })
            const configToWrite: RPGProjectConfig = { ...DEFAULT_CONFIG }
            if (options.embed) {
              configToWrite.embedding = {
                provider: 'voyage-ai',
                model: 'voyage-code-3',
                dimension: 1024,
                space: 'voyage-v4',
              }
            }
            await writeFile(
              path.join(rpgDir, 'config.json'),
              JSON.stringify(configToWrite, null, 2),
            )
            log.success('Created .rpg/config.json')
          }

          // 2. Create .rpg/local/ directory
          await mkdir(path.join(localDir, 'vectors'), { recursive: true })
          log.success('Created .rpg/local/ directory')

          // 3. Add .rpg/local/ to .gitignore
          await ensureGitignoreEntry(absPath, '.rpg/local/')

          // 4. Install git hooks if requested
          if (options.hooks) {
            const { installHooks } = await import('./hooks')
            await installHooks(absPath)
          }

          // 5. Generate CI workflow if requested
          if (options.ci) {
            await generateCIWorkflow(absPath)
          }

          // 6. Run initial encode if requested
          if (options.encode) {
            const { RPGEncoder } = await import('@pleaseai/rpg-encoder')
            const { getHeadCommitSha } = await import('@pleaseai/rpg-utils/git-helpers')

            log.start('Running initial encode...')
            const encoder = new RPGEncoder(absPath)
            const result = await encoder.encode()

            // Stamp with HEAD
            const headSha = getHeadCommitSha(absPath)
            const currentConfig = result.rpg.getConfig()
            result.rpg.updateConfig({
              github: {
                owner: currentConfig.github?.owner ?? '',
                repo: currentConfig.github?.repo ?? currentConfig.name,
                commit: headSha,
                pathPrefix: currentConfig.github?.pathPrefix,
              },
            })

            const outputPath = path.join(rpgDir, 'graph.json')
            await writeFile(outputPath, await result.rpg.toJSON())
            log.success(`Encoded ${result.filesProcessed} files → .rpg/graph.json`)
          }

          log.success('RPG initialized')
        }
        catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          log.error(`Init failed: ${msg}`)
          if (options.encode && (msg.includes('rev-parse') || msg.includes('HEAD'))) {
            log.info('Hint: The --encode flag requires at least one git commit.')
          }
          process.exit(1)
        }
      },
    )
}

export async function ensureGitignoreEntry(repoPath: string, pattern: string): Promise<void> {
  const gitignorePath = path.join(repoPath, '.gitignore')
  let content = ''

  if (existsSync(gitignorePath)) {
    content = await readFile(gitignorePath, 'utf-8')
    const lines = content.split('\n').map(l => l.trim())
    if (lines.includes(pattern)) {
      log.debug(`.gitignore already contains "${pattern}"`)
      return
    }
  }

  const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : ''
  const section = `${separator}\n# RPG local data\n${pattern}\n`
  await writeFile(gitignorePath, content + section)
  log.success(`Added "${pattern}" to .gitignore`)
}

export async function generateCIWorkflow(repoPath: string): Promise<void> {
  const workflowDir = path.join(repoPath, '.github', 'workflows')
  const workflowPath = path.join(workflowDir, 'rpg-encode.yml')

  if (existsSync(workflowPath)) {
    log.warn('.github/workflows/rpg-encode.yml already exists, skipping')
    return
  }

  await mkdir(workflowDir, { recursive: true })

  // import.meta.dirname = packages/cli/src/commands/
  // Template is at packages/cli/src/templates/rpg-encode.yml
  const templatePath = path.join(import.meta.dirname, '..', 'templates', 'rpg-encode.yml')
  let template: string
  if (existsSync(templatePath)) {
    template = await readFile(templatePath, 'utf-8')
  }
  else {
    log.error(`CI workflow template not found at ${templatePath}`)
    return
  }

  await writeFile(workflowPath, template)
  log.success('Created .github/workflows/rpg-encode.yml')
}
