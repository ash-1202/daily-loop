import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // In development the web app calls /api/* on its own origin and Vite forwards it to the API,
    // so there is no CORS setup and cookies behave like production on a single domain.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
