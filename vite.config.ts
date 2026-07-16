import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import terser from '@rollup/plugin-terser';

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production';
  
  return {
    plugins: [
      react(),
      // Only enable source maps in development
      ...(isProduction ? [] : [])
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
      port: 3000,
      host: true,
      proxy: {
        '/api-omegatech': {
          target: 'https://omegatech-api.dixonomega.tech',
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
        },
        // Proxy admin and API routes to Express backend
        '/admin': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          timeout: 10000
        },
        '/api/visitors': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          timeout: 10000
        },
        '/api/domain': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          timeout: 10000
        },
        '/api/event': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          timeout: 10000
        },
        '/_i18n': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          timeout: 10000
        },
        '/manifest.webmanifest': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          timeout: 10000
        }
      }
    },
    // Production server configuration for standalone preview
    preview: {
      port: Number(process.env.PORT) || 3000,
      host: true,
      proxy: {
        '/api-omegatech': {
          target: 'https://omegatech-api.dixonomega.tech',
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
        },
        '/admin': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          timeout: 10000
        },
        '/api/visitors': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          timeout: 10000
        },
        '/api/domain': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          timeout: 10000
        },
        '/api/event': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          timeout: 10000
        },
        '/_i18n': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          timeout: 10000
        },
        '/manifest.webmanifest': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          timeout: 10000
        }
      }
    }
  };
});
