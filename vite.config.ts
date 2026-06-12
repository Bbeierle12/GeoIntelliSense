import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
    return {
      server: {
        port: 5174,
        // Bind to loopback only — exposing the dev server on all interfaces
        // amplifies dev-server file-read advisories (e.g. GHSA-p9ff-h696-f583).
        // Use `vite --host` explicitly when LAN access (e.g. device testing) is needed.
        host: '127.0.0.1',
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks: {
              // Split Three.js + React Three Fiber into its own chunk (~800KB)
              'three-vendor': ['three', '@react-three/fiber', '@react-three/drei'],
              // Split Recharts into its own chunk (~300KB)
              'recharts-vendor': ['recharts'],
              // Split React core
              'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            },
          },
        },
        // Target modern browsers for smaller output
        target: 'es2020',
        // Reporting
        chunkSizeWarningLimit: 500,
      },
      test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './tests/setup.ts',
        css: true,
      }
    };
});
