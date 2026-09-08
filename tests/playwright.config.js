// @ts-check
const { defineConfig } = require('@playwright/test');
const fs = require('node:fs');

// Use the environment's preinstalled Chromium when available (local dev
// container); in CI, `playwright install chromium` provides the browser.
const localChromium = '/opt/pw-browsers/chromium';
const executablePath =
  !process.env.CI && fs.existsSync(localChromium) ? localChromium : undefined;

module.exports = defineConfig({
  testDir: '.',
  // Named explicitly rather than globbed: scratch specs written into tests/
  // during exploration would otherwise join the suite and run in CI. Add new
  // suites here deliberately.
  testMatch: ['app.spec.js'],
  timeout: 20000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: { executablePath },
  },
  webServer: {
    command: 'node server.mjs',
    port: 4173,
    reuseExistingServer: true,
  },
});
