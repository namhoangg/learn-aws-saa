import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// content/ lives at the project root next to src/ and is imported with import.meta.glob,
// so the dev server watches it and reloads when a lesson or quiz file changes.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, open: false },
  build: { chunkSizeWarningLimit: 4000 },
});
