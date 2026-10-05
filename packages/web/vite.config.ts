import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Universal Router Manager — web client (PWA).
 *
 * The browser never calls the router directly: everything goes through the
 * Local Bridge. In development Vite proxies `/api` to the bridge on
 * 127.0.0.1:8787 so browser-facing code only ever uses relative URLs.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT ?? 5173),
    strictPort: false,
    // The Arena preview proxies the sandbox through a public hostname.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.URLM_BRIDGE ?? 'http://127.0.0.1:8787',
        changeOrigin: true,
        ws: false,
      },
    },
  },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
