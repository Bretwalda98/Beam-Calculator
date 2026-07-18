import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname),
  base: '/frame3d/',
  build: {
    outDir: resolve(__dirname, '../../dist/frame3d'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022'
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
