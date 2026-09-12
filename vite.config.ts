import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import terser from '@rollup/plugin-terser';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production';
  
  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icons/*', 'manifest.webmanifest'],
        manifest: {
          id: 'slflix',
          name: 'SLFLIX PRO',
          short_name: 'SLFLIX',
          description: 'SLFLIX PRO - Free Movies, TV Shows & Live TV Streaming',
          theme_color: '#0a0a0f',
          background_color: '#0a0a0f',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/icons/icon-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: '/icons/icon-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: '/icons/slflix.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable'
            }
          ]
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] }
              }
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] }
              }
            },
            {
              urlPattern: /\/api\/(tv|home|movies|series|search|metadata|cineverse|omegatech).*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-metadata-cache',
                expiration: {
                  maxEntries: 150,
                  maxAgeSeconds: 60 * 60 * 24 * 7
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            },
            {
              urlPattern: /\/api\/tv\/img.*/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'tv-images-cache',
                expiration: {
                  maxEntries: 200,
                  maxAgeSeconds: 60 * 60 * 24 * 14
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            }
          ]
        },
        devOptions: {
          enabled: true,
          type: 'module'
        }
      })
    ],
    build: {
      outDir: 'dist',
      sourcemap: false, // Always disabled in production
      minify: 'terser',
      target: 'es2020', // Fix ESM/strict mode issues
      cssCodeSplit: true,
      assetsInlineLimit: 4096,
      reportCompressedSize: false, // Faster builds
      emptyOutDir: true,
      chunkSizeWarningLimit: 1000,
      terserOptions: {
        compress: {
          drop_console: isProduction,
          drop_debugger: isProduction,
          pure_funcs: isProduction ? ['console.log', 'console.info', 'console.debug'] : [],
        },
        mangle: isProduction ? {
          properties: false, // Fix ReactCurrentOwner error - don't mangle React internals
        } : true,
        format: {
          comments: false,
        },
      },
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-hls': ['hls.js'],
            'vendor-icons': ['lucide-react'],
          },
          // Obfuscated chunk names for production
          chunkFileNames: isProduction ? 'assets/[hash].js' : 'assets/[name]-[hash].js',
          entryFileNames: isProduction ? 'assets/[hash].js' : 'assets/[name]-[hash].js',
          assetFileNames: isProduction ? 'assets/[hash].[ext]' : 'assets/[name]-[hash].[ext]',
        },
      },
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'hls.js', 'lucide-react'],
      exclude: [], // Prevent dup React
    },
    define: {
      __DEV__: !isProduction,
    },
    
    server: {
      host: true,
      hmr: {
        port: 24678
      },
      proxy: {
        '/api-omegatech': {
          target: 'https://api.omegatech.app',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-omegatech/, ''),
          timeout: 15000
        },
        '/api-metadata': {
          target: 'https://h5-api.aoneroom.com/wefeed-h5api-bff',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-metadata/, ''),
          headers: {
            'Origin': 'https://moviebox.ph',
            'Referer': 'https://moviebox.ph/'
          },
          timeout: 15000
        },
        '/api-player': {
          target: 'https://123movienow.cc/wefeed-h5api-bff',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-player/, ''),
          headers: {
            'Origin': 'https://123movienow.cc',
            'Referer': 'https://123movienow.cc/'
          },
          timeout: 15000
        },
        '/api-cineverse': {
          target: 'https://cineverse.name.ng',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-cineverse/, ''),
          headers: {
            'Origin': 'https://cineverse.name.ng',
            'Referer': 'https://cineverse.name.ng/'
          },
          timeout: 15000
        },
        '/api-stream': {
          target: 'https://movieapi.giftedtech.co.ke',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-stream/, ''),
          headers: {
            'Origin': 'https://movieapi.giftedtech.co.ke',
            'Referer': 'https://movieapi.giftedtech.co.ke/'
          },
          timeout: 15000
        }
      }
    },
    // Production server configuration for standalone preview
    preview: {
      port: Number(process.env.PORT) || 3000,
      host: true,
      proxy: {
        '/api-omegatech': {
          target: 'https://api.omegatech.app',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-omegatech/, ''),
          timeout: 15000
        },
        '/api-metadata': {
          target: 'https://h5-api.aoneroom.com/wefeed-h5api-bff',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-metadata/, ''),
          headers: {
            'Origin': 'https://moviebox.ph',
            'Referer': 'https://moviebox.ph/'
          },
          timeout: 15000
        },
        '/api-player': {
          target: 'https://123movienow.cc/wefeed-h5api-bff',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-player/, ''),
          headers: {
            'Origin': 'https://123movienow.cc',
            'Referer': 'https://123movienow.cc/'
          },
          timeout: 15000
        },
        '/api-cineverse': {
          target: 'https://cineverse.name.ng',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-cineverse/, ''),
          headers: {
            'Origin': 'https://cineverse.name.ng',
            'Referer': 'https://cineverse.name.ng/'
          },
          timeout: 15000
        },
        '/api-stream': {
          target: 'https://movieapi.giftedtech.co.ke',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-stream/, ''),
          headers: {
            'Origin': 'https://movieapi.giftedtech.co.ke',
            'Referer': 'https://movieapi.giftedtech.co.ke/'
          },
          timeout: 15000
        }
      }
    }
  };
});
