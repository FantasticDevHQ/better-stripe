/**
 * Vitest configuration for the better-stripe package.
 *
 * Uses the edge-runtime environment because Convex component functions
 * run in V8 isolates with Web Standard APIs (not Node.js). This ensures
 * tests execute in the same runtime constraints as production.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'edge-runtime',
    exclude: ['dist/**', 'node_modules/**', 'example/**'],
  },
});
