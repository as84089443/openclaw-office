import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const originalOpenclawDir = process.env.OPENCLAW_DIR

const {
  buildGatewayOperatorDeviceAuth,
  loadGatewayOperatorIdentity,
  resolveGatewayOperatorToken,
} = await import('../lib/gateway-operator-auth.js')

test.afterEach(() => {
  if (originalOpenclawDir === undefined) delete process.env.OPENCLAW_DIR
  else process.env.OPENCLAW_DIR = originalOpenclawDir
})

test('resolveGatewayOperatorToken prefers full-scope operator token over shared gateway token', () => {
  assert.equal(resolveGatewayOperatorToken({
    gatewayToken: 'shared-token',
    deviceIdentity: { operatorToken: 'operator-token' },
  }), 'operator-token')

  assert.equal(resolveGatewayOperatorToken({
    gatewayToken: 'shared-token',
    deviceIdentity: null,
  }), 'shared-token')
})

test('loadGatewayOperatorIdentity reads device identity and operator token from OPENCLAW_DIR', () => {
  const root = mkdtempSync(join(tmpdir(), 'openclaw-gateway-operator-auth-'))
  const identityDir = join(root, 'identity')
  mkdirSync(identityDir, { recursive: true })

  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

  writeFileSync(join(identityDir, 'device.json'), JSON.stringify({
    deviceId: 'device-123',
    publicKeyPem,
    privateKeyPem,
  }))
  writeFileSync(join(identityDir, 'device-auth.json'), JSON.stringify({
    tokens: {
      operator: {
        token: 'operator-token-123',
      },
    },
  }))

  process.env.OPENCLAW_DIR = root

  const identity = loadGatewayOperatorIdentity()
  assert.equal(identity.deviceId, 'device-123')
  assert.equal(identity.operatorToken, 'operator-token-123')
  assert.match(identity.publicKeyPem, /BEGIN PUBLIC KEY/)
  assert.match(identity.privateKeyPem, /BEGIN PRIVATE KEY/)
})

test('buildGatewayOperatorDeviceAuth emits signed device payload', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

  const device = buildGatewayOperatorDeviceAuth({
    deviceIdentity: {
      deviceId: 'device-xyz',
      publicKeyPem,
      privateKeyPem,
    },
    clientId: 'gateway-client',
    clientMode: 'backend',
    role: 'operator',
    scopes: ['operator.read', 'operator.write'],
    token: 'operator-token',
    nonce: 'nonce-123',
    platform: 'darwin',
    signedAtMs: 1234567890,
  })

  assert.equal(device.id, 'device-xyz')
  assert.equal(device.nonce, 'nonce-123')
  assert.equal(device.signedAt, 1234567890)
  assert.match(device.publicKey, /^[A-Za-z0-9_-]+$/)
  assert.match(device.signature, /^[A-Za-z0-9_-]+$/)
})
