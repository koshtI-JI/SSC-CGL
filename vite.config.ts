import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  const base = process.env.BASE_PATH || '/';

  return {
    base,

    plugins: [
      react(),
      tailwindcss(),

      VitePWA({
        registerType: 'prompt',

        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png'
        ],

        manifest: {
          id: base,
          name: 'Path to CGL — Private SSC CGL Cohort',
          short_name: 'Path to CGL',

          description:
            'Private invite-only SSC CGL mock exam platform with TCS iON interface, zero-loss test resume, and cohort analytics.',

          theme_color: '#1e3a8a',
          background_color: '#f2f4f7',

          display: 'standalone',

          start_url: base,
          scope: base,

          icons: [
            {
              src: `${base}pwa-192x192.png`,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: `${base}pwa-512x512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: `${base}pwa-maskable-512x512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },

        workbox: {
          cleanupOutdatedCaches: true,
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,

          globPatterns: [
            '**/*.{js,css,html,ico,png,jpg,svg,woff,woff2}'
          ],

          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },

        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],

    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },

    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('/firebase/') || id.includes('/@firebase/')) {
              return 'vendor-firebase';
            }
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/scheduler/')
            ) {
              return 'vendor-react';
            }
            if (id.includes('/lucide-react/')) {
              return 'vendor-icons';
            }
            if (id.includes('/motion/') || id.includes('/framer-motion/')) {
              return 'vendor-motion';
            }
            if (id.includes('/pdfjs-dist/')) {
              return 'vendor-pdf';
            }
            return undefined;
          },
        },
      },
    },

    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },

    preview: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
    },
  };
});