# Troubleshooting

Common issues and how to fix them.

## Gateway Connection

### `gateway token mismatch`
```
[openclaw-ws] Disconnected: 1008 unauthorized: gateway token mismatch
```
Your `OPENCLAW_GATEWAY_TOKEN` in `.env.local` doesn't match the gateway's token. Check with:
```bash
openclaw status
```
Copy the correct token into `.env.local`.

### `control ui requires device identity`
The gateway requires Ed25519 device identity signing. Make sure `~/.openclaw/identity/device.json` exists. If not, re-run `openclaw onboard`.

### No gateway running
**This is fine.** The dashboard works without a gateway — you'll see the full UI with empty data. The WebSocket will reconnect automatically when a gateway becomes available.

To suppress connection logs, the app automatically quiets down after 3 failed attempts.

## Port Issues

### `EADDRINUSE: address already in use :::4200`
Another process is using port 4200. Either stop it or use a different port:
```bash
PORT=4201 npm start
```

To find what's using port 4200:
```bash
lsof -i :4200
```

## Build Warnings

### `Mismatching @next/swc version`
```
⚠ Mismatching @next/swc version, detected: 15.5.7 while Next.js is on 15.5.11
```
**Harmless.** This is an upstream Next.js issue. The build works fine.

### `npm warn deprecated` messages
```
npm warn deprecated inflight@1.0.6
npm warn deprecated eslint@8.57.1
```
**Harmless.** These are transitive dependencies. They don't affect the app.

### `3 vulnerabilities` on npm install
**Harmless for local use.** These are from dev dependencies and don't affect the running dashboard.

## Interactive Wizard

### `ExitPromptError: User force closed the prompt`
The wizard requires an interactive terminal (TTY). If running in CI, Docker, or a non-interactive shell, use:
```bash
node cli/index.js init --non-interactive
```

Or manually create `openclaw-office.config.json` and `.env.local` from the example files.
