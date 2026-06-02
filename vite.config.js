import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', '*.png', '*.svg'],
      manifest: {
        name: 'Flota Emporium',
        short_name: 'Flota',
        description: 'Control de Flota - Transporte Emporium',
        theme_color: '#1B4332',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.sheetjs\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'xlsx-cache', expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'fonts-cache', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  build: { outDir: 'dist' },
});
