import WebSocket from 'ws'
import crypto from 'crypto'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

import { getConfig } from './config.js'

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function base64UrlEncode(buf) {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function loadDeviceIdentity() {
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

function signDeviceAuth({ deviceId, privateKeyPem, clientId, clientMode, role, scopes, signedAtMs, token, nonce, platform, deviceFamily }) {
  const payload = [
    'v3', deviceId, clientId, clientMode, role,
    scopes.join(','), String(signedAtMs), token || '',
    nonce, platform || '', deviceFamily || '',
  ].join('|')

  const key = crypto.createPrivateKey(privateKeyPem)
  const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), key)
  return base64UrlEncode(sig)
}

function publicKeyToRawBase64Url(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem)
  const spki = key.export({ type: 'spki', format: 'der' })
  const raw = spki.subarray(12)
  return base64UrlEncode(raw)
}

function toWsUrl(url) {
  const parsed = new URL(url)
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
  return parsed.toString()
}

export class GatewayRpcError extends Error {
  constructor(message, code, details) {
    super(message)
    this.name = 'GatewayRpcError'
    this.code = code
    this.details = details
  }
}

class GatewayRpcClient {
  constructor(gatewayUrl, token) {
    this.gatewayUrl = gatewayUrl
    this.token = token
    this.ws = null
    this.connectPromise = null
    this.connectResolve = null
    this.connectReject = null
    this.connectRequestId = null
    this.connectRequestSent = false
    this.connectTimeoutTimer = null
    this.connectKickTimer = null
    this.supportedMethods = new Set()
    this.pending = new Map()
    this.seq = 0
    this.challengeNonce = null
  }

  async request(method, params = {}, timeout = 15000) {
    await this.connect(timeout)

    if (this.supportedMethods.size > 0 && !this.supportedMethods.has(method)) {
      throw new GatewayRpcError(`Gateway does not support method: ${method}`, 'UNSUPPORTED_METHOD')
    }

    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new GatewayRpcError('Gateway RPC socket is not connected')
    }

    const id = this.nextId()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new GatewayRpcError(`Gateway RPC timed out for ${method}`))
      }, timeout)

      this.pending.set(id, { resolve, reject, timer })

      try {
        ws.send(JSON.stringify({
          type: 'req',
          id,
          method,
          params,
        }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(this.normalizeError(error))
      }
    })
  }

  async connect(timeout) {
    if (this.ws?.readyState === WebSocket.OPEN && this.connectRequestId === null) {
      return
    }
    if (this.connectPromise) {
      return this.connectPromise
    }

    this.connectPromise = new Promise((resolve, reject) => {
      const onResolve = () => {
        this.clearConnectState()
        this.connectPromise = null
        resolve()
      }
      const onReject = (error) => {
        this.clearConnectState()
        this.connectPromise = null
        this.closeSocket()
        reject(error)
      }

      this.connectResolve = onResolve
      this.connectReject = onReject
      this.connectRequestId = this.nextId()
      this.connectRequestSent = false

      this.connectTimeoutTimer = setTimeout(() => {
        onReject(new GatewayRpcError('Gateway RPC connect timed out'))
      }, timeout)

      try {
        const ws = new WebSocket(toWsUrl(this.gatewayUrl), {
          headers: {
            Origin: 'http://127.0.0.1:4200',
          },
        })
        this.ws = ws

        ws.addEventListener('open', () => {
          // Wait for connect.challenge so local gateway device auth can include the required nonce.
        })
        ws.addEventListener('message', (event) => {
          this.handleMessage(String(event.data ?? ''))
        })
        ws.addEventListener('close', (event) => {
          const reason = String(event.reason || 'socket closed')
          this.handleSocketClosed(
            new GatewayRpcError(`Gateway RPC socket closed (${event.code}): ${reason}`),
          )
        })
        ws.addEventListener('error', () => {
          if (this.ws?.readyState !== WebSocket.OPEN && this.connectReject) {
            this.connectReject(new GatewayRpcError('Gateway RPC socket error'))
          }
        })
      } catch (error) {
        if (this.connectTimeoutTimer) clearTimeout(this.connectTimeoutTimer)
        onReject(this.normalizeError(error))
      }
    })

    return this.connectPromise
  }

  handleMessage(raw) {
    let message
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }

    if (message?.type === 'event') {
      if (message.event === 'connect.challenge') {
        this.challengeNonce = isRecord(message.payload) ? String(message.payload.nonce || '') : ''
        this.sendConnectRequest()
      }
      return
    }

    if (message?.type !== 'res') return

    if (message.id && message.id === this.connectRequestId) {
      if (message.ok) {
        const hello = isRecord(message.payload) ? message.payload : {}
        const features = isRecord(hello.features) ? hello.features : {}
        this.supportedMethods = new Set(Array.isArray(features.methods) ? features.methods : [])
        this.connectResolve?.()
      } else {
        this.connectReject?.(this.normalizeGatewayError(message.error))
      }
      return
    }

    const pending = message.id ? this.pending.get(message.id) : undefined
    if (!pending || !message.id) return

    clearTimeout(pending.timer)
    this.pending.delete(message.id)

    if (message.ok) {
      pending.resolve(message.payload)
      return
    }

    pending.reject(this.normalizeGatewayError(message.error))
  }

  scheduleConnectRequest() {
    if (this.connectRequestSent || this.connectKickTimer) return
    this.connectKickTimer = setTimeout(() => {
      this.connectKickTimer = null
      this.sendConnectRequest()
    }, 750)
  }

  sendConnectRequest() {
    if (this.connectRequestSent || !this.connectRequestId) return
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    this.connectRequestSent = true
    if (this.connectKickTimer) {
      clearTimeout(this.connectKickTimer)
      this.connectKickTimer = null
    }

    const token = this.token || ''
    const connectParams = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'openclaw-control-ui',
        version: '1.0.0',
        platform: 'nodejs',
        mode: 'ui',
      },
      role: 'operator',
      scopes: ['operator.admin', 'operator.approvals', 'operator.pairing'],
      caps: [],
      locale: 'zh-TW',
      userAgent: 'openclaw-office/0.1.0',
    }

    const deviceIdentity = loadDeviceIdentity()
    if (deviceIdentity && this.challengeNonce) {
      const signedAtMs = Date.now()
      const nonce = this.challengeNonce
      const clientId = 'openclaw-control-ui'
      const clientMode = 'ui'
      const role = 'operator'
      const scopes = ['operator.admin', 'operator.approvals', 'operator.pairing']
      const signature = signDeviceAuth({
        deviceId: deviceIdentity.deviceId,
        privateKeyPem: deviceIdentity.privateKeyPem,
        clientId,
        clientMode,
        role,
        scopes,
        signedAtMs,
        token,
        nonce,
        platform: 'nodejs',
        deviceFamily: '',
      })
      connectParams.device = {
        id: deviceIdentity.deviceId,
        publicKey: publicKeyToRawBase64Url(deviceIdentity.publicKeyPem),
        signature,
        signedAt: signedAtMs,
        nonce,
      }
    }
    if (token) connectParams.auth = { token }

    ws.send(JSON.stringify({
      type: 'req',
      id: this.connectRequestId,
      method: 'connect',
      params: connectParams,
    }))
  }

  handleSocketClosed(error) {
    if (this.connectReject) {
      this.connectReject(error)
    }
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer)
      pending.reject(error)
      this.pending.delete(id)
    }
    this.supportedMethods.clear()
    this.closeSocket()
  }

  clearConnectState() {
    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer)
      this.connectTimeoutTimer = null
    }
    if (this.connectKickTimer) {
      clearTimeout(this.connectKickTimer)
      this.connectKickTimer = null
    }
    this.connectResolve = null
    this.connectReject = null
    this.connectRequestId = null
    this.connectRequestSent = false
    this.challengeNonce = null
  }

  closeSocket() {
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        // ignore
      }
    }
    this.ws = null
  }

  nextId() {
    this.seq += 1
    return `office-${this.seq}`
  }

  normalizeGatewayError(error) {
    if (isRecord(error)) {
      return new GatewayRpcError(
        String(error.message || error.code || 'Gateway request failed'),
        typeof error.code === 'string' ? error.code : undefined,
        error.details,
      )
    }
    return new GatewayRpcError('Gateway request failed')
  }

  normalizeError(error) {
    if (error instanceof GatewayRpcError) return error
    return new GatewayRpcError(error instanceof Error ? error.message : String(error))
  }
}

let cachedClient = null
let cachedKey = null

function getGatewayClient() {
  const config = getConfig()
  const gatewayUrl = String(config?.gateway?.url || '').trim()
  const token = String(config?.gateway?.token || '').trim()
  if (!gatewayUrl) {
    throw new GatewayRpcError('Gateway URL is missing from OpenClaw Office config')
  }

  const cacheKey = `${gatewayUrl}|${token}`
  if (!cachedClient || cachedKey !== cacheKey) {
    cachedClient = new GatewayRpcClient(gatewayUrl, token)
    cachedKey = cacheKey
  }
  return cachedClient
}

export async function gatewayCall(method, params = {}, timeout = 15000) {
  return getGatewayClient().request(method, params, timeout)
}
