import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      // changeOrigin rewrites Host to the backend's own address, which its
      // DNS-rebinding guard requires (ADR 0007).
      '/api': { target: 'http://127.0.0.1:7777', changeOrigin: true },
    },
  },
  build: {
    // The backend serves these files from the Composer package (ADR 0003).
    outDir: '../backend/public',
    emptyOutDir: true,
  },
});
