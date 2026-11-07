import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// Frontend component tests (Website 1, 2026-11-04) — jsdom, no network, no
// backend. Contexts and API calls are mocked per test file.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // Website 9: module caches that must not leak between tests
    setupFiles: ['./src/test/setup.ts'],
  },
});
