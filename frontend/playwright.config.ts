import { defineConfig } from '@playwright/test';

const port = 7799;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${String(port)}`,
    viewport: { width: 1440, height: 900 },
    // CI machines have no GPU: SwiftShader renders WebGL in software.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    // The real CLI on the built frontend, as a user runs it.
    command: `php ../backend/bin/zendscape serve --port=${String(port)} ../fixtures/static-cache.t0.rmem ../fixtures/static-cache.t1.rmem`,
    url: `http://127.0.0.1:${String(port)}/api/snapshots`,
    reuseExistingServer: false,
  },
});
