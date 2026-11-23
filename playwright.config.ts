import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173/weigh-mix-hand-sim/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'touch', use: { ...devices['Pixel 7'], viewport: { width: 412, height: 915 } } },
  ],
  webServer: {
    command: 'pnpm preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/weigh-mix-hand-sim/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
