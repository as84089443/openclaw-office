#!/usr/bin/env node
// Reads port from openclaw-office.config.json and starts Next.js
import { readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';

let port = 4200;
let host = '0.0.0.0';

// Read from config
try {
  if (existsSync('openclaw-office.config.json')) {
    const config = JSON.parse(readFileSync('openclaw-office.config.json', 'utf8'));
    port = config.deployment?.port || config.port || 4200;
  }
} catch {}

// Env override still works
if (process.env.PORT) port = process.env.PORT;

console.log(`Starting OpenClaw Office on port ${port}...`);
const nextBin = join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
execFileSync(process.execPath, [nextBin, 'start', '-p', String(port), '-H', host], { stdio: 'inherit' });
