import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4280,
    proxy: {
      // Force IPv4 — Node 17+ resolves "localhost" to ::1 first, but the
      // Azure Functions Core Tools host binds to 127.0.0.1, so the proxy
      // would otherwise return 500 with an empty body.
      '/api': {
        target: 'http://127.0.0.1:7071',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
