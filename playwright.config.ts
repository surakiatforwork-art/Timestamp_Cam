import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    timeout: 45000,
    expect: { timeout: 15000 },
    fullyParallel: false,
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:4187', trace: 'retain-on-failure', screenshot: 'only-on-failure',
        permissions: ['camera'],
        launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
    },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
        { name: 'mobile', use: { ...devices['Pixel 7'] } },
    ],
    webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4187 --strictPort', url: 'http://127.0.0.1:4187', reuseExistingServer: false },
});
