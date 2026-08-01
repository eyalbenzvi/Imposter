import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset URLs, so the same build works from the domain root, from a
  // GitHub Pages project subpath (/<repo>/), and from a local file preview.
  base: './',
  plugins: [react()],
  server: { host: true },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
