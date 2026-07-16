import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname),
  base: '/frame3d/solid/',
  build: {
    outDir: resolve(__dirname, '../../dist/frame3d/solid'),
    emptyOutDir: false,
    sourcemap: false,
    target: 'es2022'
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4173'
    }
  }
});
