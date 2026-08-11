import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.MF_E2E_BASE_URL;

if (!baseURL) {
  throw new Error('MF_E2E_BASE_URL é obrigatório para o smoke autenticado de Preview.');
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
});
