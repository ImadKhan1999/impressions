import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  clean: true,
  // Bundle the workspace package; keep real npm dependencies external.
  noExternal: ['@impressions/shared'],
  banner: {
    // Allow bundled CJS deps that call require() to work inside the ESM bundle.
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
