import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // The backend serves these files from the Composer package (ADR 0003).
    outDir: '../backend/public',
    emptyOutDir: true,
  },
});
