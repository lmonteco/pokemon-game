import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Relative base: this builds correctly for a GitHub project-pages URL
// (https://<user>.github.io/<repo>/) and for `vite preview` and file:// alike,
// without baking the repository name into the build.
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
