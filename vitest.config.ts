import { defineConfig } from 'vitest/config';

// Rules tests run in Node against the Firebase Database emulator.
// Kept separate from vite.config.ts so the app build is untouched.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each rules test file uses its own projectId → its own emulator database
    // namespace, so files are isolated and safe to run in parallel.
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
