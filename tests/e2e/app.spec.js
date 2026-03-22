import { test, expect } from '@playwright/test'

test.describe('Surface Smoke', () => {
  test('homepage shows current BW entry points', async ({ page }) => {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBe(200)

    await expect(page.getByText('OpenClaw BW Copilot')).toBeVisible()
    await expect(page.getByRole('link', { name: /Merchant Copilot/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /Ops Console/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /BW Office/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /Browser Runtime/i })).toBeVisible()
  })

  test('office route opens Boss Inbox dashboard shell', async ({ page }) => {
    const response = await page.goto('/office', { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBe(200)

    await expect(page.getByText('Boss Inbox')).toBeVisible()
    await expect(page.getByRole('button', { name: /Refresh/i })).toBeVisible()
  })

  test('ops route renders console shell', async ({ page }) => {
    const response = await page.goto('/ops', { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBe(200)

    await expect(page.getByText(/BW Copilot/i).first()).toBeVisible()
  })

  test('browser route renders runtime dashboard shell', async ({ page }) => {
    const response = await page.goto('/browser', { waitUntil: 'domcontentloaded' })
    expect(response?.status()).toBe(200)

    await expect(page.getByText(/Browser/i).first()).toBeVisible()
  })
})

test.describe('API Smoke', () => {
  test('GET /api/health returns JSON', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toBeDefined()
  })

  test('GET /api/config returns canonical config payload', async ({ request }) => {
    const res = await request.get('/api/config')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('agents')
  })

  test('GET /api/stats returns stats payload', async ({ request }) => {
    const res = await request.get('/api/stats')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toBeDefined()
  })

  test('GET /api/workflow returns workflow payload', async ({ request }) => {
    const res = await request.get('/api/workflow')
    expect(res.status()).toBe(200)
  })

  test('GET /api/boss-inbox returns boss inbox payload', async ({ request }) => {
    const authStateRes = await request.get('/api/office/session')
    expect(authStateRes.status()).toBe(200)
    const authState = await authStateRes.json()

    const res = await request.get('/api/boss-inbox')
    if (authState.configured && !authState.authenticated) {
      expect(res.status()).toBe(401)
      return
    }

    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('attentionItems')
  })

  test('GET /api/office/session returns office auth state', async ({ request }) => {
    const res = await request.get('/api/office/session')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('configured')
    expect(body).toHaveProperty('authenticated')
  })
})

test.describe('Routing', () => {
  test('unknown route returns 404', async ({ page }) => {
    const res = await page.goto('/nonexistent-page-xyz', { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(404)
  })
})
