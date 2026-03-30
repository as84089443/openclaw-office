import crypto from 'crypto'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

function base64UrlEncode(buf) {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

export function loadGatewayOperatorIdentity() {
  const openclawDir = process.env.OPENCLAW_DIR || join(homedir(), '.openclaw')
  const devicePath = join(openclawDir, 'identity', 'device.json')
  const authPath = join(openclawDir, 'identity', 'device-auth.json')

  if (!existsSync(devicePath)) return null

  try {
    const device = JSON.parse(readFileSync(devicePath, 'utf-8'))
    let operatorToken = ''
    if (existsSync(authPath)) {
      const auth = JSON.parse(readFileSync(authPath, 'utf-8'))
      operatorToken = auth.tokens?.operator?.token || ''
    }
    return {
      deviceId: device.deviceId,
      publicKeyPem: device.publicKeyPem,
      privateKeyPem: device.privateKeyPem,
      operatorToken,
    }
  } catch {
    return null
  }
}

export function resolveGatewayOperatorToken({ gatewayToken = '', deviceIdentity = null } = {}) {
  return String(deviceIdentity?.operatorToken || gatewayToken || '').trim()
}

function publicKeyToRawBase64Url(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem)
  const spki = key.export({ type: 'spki', format: 'der' })
  const raw = spki.subarray(12)
  return base64UrlEncode(raw)
}

function signGatewayDeviceAuth({
  deviceId,
  privateKeyPem,
  clientId,
  clientMode,
  role,
  scopes,
  signedAtMs,
  token,
  nonce,
  platform,
  deviceFamily,
}) {
  const safePlatform = String(platform || '').trim()
  const safeDeviceFamily = String(deviceFamily || '').trim()
  const payload = [
    'v3',
    deviceId,
    clientId,
    clientMode,
    role,
    scopes.join(','),
    String(signedAtMs),
    token || '',
    nonce,
    safePlatform,
    safeDeviceFamily,
  ].join('|')

  const key = crypto.createPrivateKey(privateKeyPem)
  const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), key)
  return base64UrlEncode(sig)
}

export function buildGatewayOperatorDeviceAuth({
  deviceIdentity = null,
  clientId,
  clientMode,
  role,
  scopes,
  token = '',
  nonce = '',
  platform = '',
  deviceFamily = '',
  signedAtMs = Date.now(),
} = {}) {
  if (!deviceIdentity?.deviceId || !deviceIdentity?.publicKeyPem || !deviceIdentity?.privateKeyPem) {
    return null
  }

  return {
    id: deviceIdentity.deviceId,
    publicKey: publicKeyToRawBase64Url(deviceIdentity.publicKeyPem),
    signature: signGatewayDeviceAuth({
      deviceId: deviceIdentity.deviceId,
      privateKeyPem: deviceIdentity.privateKeyPem,
      clientId,
      clientMode,
      role,
      scopes,
      signedAtMs,
      token,
      nonce,
      platform,
      deviceFamily,
    }),
    signedAt: signedAtMs,
    nonce,
  }
}
