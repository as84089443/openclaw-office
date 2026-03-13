import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';

export async function agentsCommand() {
  const configPath = 'openclaw-office.config.json';
  if (!existsSync(configPath)) {
    console.log(chalk.red('\n  ❌ No configuration found. Run `openclaw-office init` first.\n'));
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  // agents can be an object {id: {...}} or an array [{...}]
  const agentsRaw = config.agents || {};
  const agents = Array.isArray(agentsRaw)
    ? agentsRaw
    : Object.entries(agentsRaw).map(([id, data]) => ({ id, ...data }));

  console.log();
  console.log(chalk.bold.cyan('  🏢 Configured Agents'));
  console.log(chalk.cyan('  ━━━━━━━━━━━━━━━━━━━━'));
  console.log();

  if (agents.length === 0) {
    console.log(chalk.dim('  No agents configured. Run `openclaw-office init` to discover agents.'));
  } else {
    for (const a of agents) {
      const emoji = a.emoji || '🤖';
      const color = a.color || '#6366f1';
      const id = a.id ? chalk.dim(` (${a.id})`) : '';
      console.log(`    ${emoji} ${chalk.hex(color).bold(a.name)}${id} — ${chalk.dim(a.role || 'Agent')}`);
    }
  }
  console.log();
}
