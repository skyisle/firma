import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  minify: true,
  splitting: false,
  noExternal: ['@modelcontextprotocol/sdk', 'zod'],
});
