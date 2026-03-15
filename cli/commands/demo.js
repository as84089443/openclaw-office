import chalk from 'chalk'
import { execSync } from 'node:child_process'

export async function demoCommand() {
  console.log(chalk.cyan('\n  🍜 Starting OpenClaw Office F&B demo...\n'))

  try {
    execSync('node scripts/run-fnb-demo.mjs', { stdio: 'inherit' })
  } catch {
    process.exit(1)
  }
}
