import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5175', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev:web', url: 'http://127.0.0.1:5175', reuseExistingServer: !process.env.CI,
  },
})
