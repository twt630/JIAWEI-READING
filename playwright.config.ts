import { defineConfig, devices } from '@playwright/test'
export default defineConfig({ testDir: './e2e', webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4173', port: 4173, reuseExistingServer: true }, use: { baseURL: 'http://127.0.0.1:4173' }, projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }] })
