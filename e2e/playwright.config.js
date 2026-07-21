const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,
  expect: { timeout: 10000 },
  use: {
    baseURL: process.env.WEATHER_GRID_BASE || 'http://localhost:8090',
    headless: true,
    screenshot: 'on',
    trace: 'retain-on-failure',
  },
  reporter: [['list']],
});
