import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Web unit/UI tests run in jsdom: no network, no canvas — the bridge is mocked,
 * which is exactly what the UI must tolerate (offline-first, spec §44).
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 20_000,
  },
});
