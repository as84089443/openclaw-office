#!/usr/bin/env node
// Reads port from openclaw-office.config.json and starts Next.js
import { readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';

let port = 4200;
let host = process.env.HOST || '0.0.0.0';

// Read from config
try {
  if (existsSync('openclaw-office.config.json')) {
    const config = JSON.parse(readFileSync('openclaw-office.config.json', 'utf8'));
    port = config.deployment?.port || config.port || 4200;
  }
} catch {}

// Env override still works
if (process.env.PORT) port = process.env.PORT;
if (process.env.OPENCLAW_BIND_HOST) host = process.env.OPENCLAW_BIND_HOST;

console.log(`Starting OpenClaw Office on port ${port}...`);
const standalonePath = join(process.cwd(), '.next', 'standalone', 'server.js');
if (existsSync(standalonePath)) {
  execFileSync(process.execPath, [standalonePath], {
    stdio: 'inherit',
    env: { ...process.env, PORT: String(port), HOST: host, HOSTNAME: host },
  });
} else {
  const nextBin = join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
  execFileSync(process.execPath, [nextBin, 'start', '-p', String(port), '-H', host], { stdio: 'inherit' });
}
