import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { resolve } from 'path';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
  ],
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, './src') },
      { find: '@lib', replacement: resolve(__dirname, './src/lib') },
      { find: '@components', replacement: resolve(__dirname, './src/components') },
      { find: '@types', replacement: resolve(__dirname, './src/types') },
      { find: '@config', replacement: resolve(__dirname, './src/config') },
      // FROST: stub the Node-only 'ws' package. @vbyte/nostr-sdk's optional
      // relay-SERVER module imports WebSocketServer from 'ws' at top level;
      // Satnam uses only BifrostNode (client) over the global WebSocket.
      // Without this alias the browser bundle would try to ship 'ws'.
      { find: /^ws$/, replacement: resolve(__dirname, './stubs/ws-stub.js') },
    ],
  },
  build: {
    target: 'es2022',
    // SECURITY: Source maps expose original source to anyone with browser DevTools.
    // Enable only for development; production builds must not ship source maps.
    sourcemap: mode !== 'production',
    minify: 'terser',
    rollupOptions: {
      output: {
        manualChunks: {
          // Core crypto — loaded eagerly (small, critical path)
          'crypto': [
            '@noble/ciphers',
            '@noble/curves',
            '@noble/hashes',
            '@scure/bip32',
            '@scure/bip39',
          ],
          // Nostr protocol — loaded eagerly
          'nostr': ['nostr-tools'],
          // Payment — lazy loaded (wallet views only)
          'payment': [
            '@getalby/lightning-tools',
            '@getalby/sdk',
            'bolt11',
          ],
          // FROST — lazy loaded (DKG/signing ceremonies only)
          'frost': ['@frostr/bifrost'],
          // Cashu — lazy loaded (wallet views only)
          'cashu': ['@cashu/cashu-ts'],
          // UI framework
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
    chunkSizeWarningLimit: 300, // Strict: warn above 300KB per chunk
  },
  optimizeDeps: {
    exclude: ['@frostr/bifrost'], // WASM — must not be pre-bundled
  },
  worker: {
    format: 'es',
  },
}));
