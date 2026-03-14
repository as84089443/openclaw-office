import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  timeout: 15000,
  use: {
    baseURL: `http://localhost:${process.env.PORT || 4200}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `PORT=${process.env.PORT || 4200} npm start`,
    port: parseInt(process.env.PORT || '4200'),
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 },
        launchOptions: { args: ['--disable-gpu'] },
      },
    },
  ],
});
