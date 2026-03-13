import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import ora from 'ora';
import { connectGateway } from '../lib/gateway.js';

export async function statusCommand() {
  const configPath = 'openclaw-office.config.json';
  if (!existsSync(configPath)) {
    console.log(chalk.red('\n  ❌ No configuration found. Run `openclaw-office init` first.\n'));
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));

  // Read version from package.json
  let version = 'unknown';
  try {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
    version = pkg.version || 'unknown';
  } catch {}

  // Count agents (config.agents is an object keyed by ID)
  const agentCount = config.agents
    ? (Array.isArray(config.agents) ? config.agents.length : Object.keys(config.agents).length)
    : 0;

  console.log();
  console.log(chalk.bold.cyan('  🏢 OpenClaw Office Status'));
  console.log(chalk.cyan('  ━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log();
  console.log(`    ${chalk.dim('Version:')}     ${version}`);
  console.log(`    ${chalk.dim('Gateway:')}     ${config.gateway?.url || 'not set'}`);
  console.log(`    ${chalk.dim('Agents:')}      ${agentCount} configured`);
  console.log(`    ${chalk.dim('Style:')}       ${config.office?.style || config.style?.theme || 'default'}`);
  console.log(`    ${chalk.dim('Deployment:')}  ${config.deployment?.method || 'manual'}`);
  console.log(`    ${chalk.dim('Port:')}        ${config.deployment?.port || 4200}`);
  console.log();

  // Test gateway connection
  const spinner = ora('Testing gateway connection...').start();
  const envPath = '.env.local';
  let token = '';
  if (existsSync(envPath)) {
    const env = readFileSync(envPath, 'utf-8');
    const match = env.match(/OPENCLAW_GATEWAY_TOKEN=(.+)/);
    if (match) token = match[1].trim();
  }

  const result = await connectGateway(config.gateway?.url || '', token);
  if (result.connected) {
    spinner.succeed(chalk.green('Gateway connected'));
  } else {
    spinner.fail(chalk.red(`Gateway unreachable: ${result.error || 'unknown'}`));
  }
  console.log();
}
