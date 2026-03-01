import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  timeout: 30000,
  use: {
    baseURL: process.env.LM_STUDIO_URL || 'http://100.117.198.97:1234',
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'lm-studio-openai',
      testMatch: /lmstudio\.api\.ts/,
    },
    {
      name: 'lm-studio-native',
      testMatch: /lmstudio\.native\.ts/,
    },
    {
      name: 'build-integrity',
      testMatch: /build\..*\.ts/,
    },
    {
      name: 'release-artifacts',
      testMatch: /release\..*\.ts/,
    },
    {
      name: 'extension-e2e',
      testMatch: /extension\..*\.ts/,
    },
    {
      name: 'lm-studio-models',
      testMatch: /lmstudio\.models\.ts/,
    },
    {
      name: 'agent-chat',
      testMatch: /agent\.chat\.ts/,
    },
  ],
});
