import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/**/*.test.ts'],
    // FROST remediation: inline bifrost/nostr-sdk so the resolver applies
    // the '^ws$' stub alias (externalized ESM would hit the real 'ws' and
    // fail on its CJS named-export detection).
    server: {
      deps: {
        inline: [/@frostr\/bifrost/, /@vbyte\/nostr-sdk/, /websocket-polyfill/],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**/*.ts', 'netlify/functions/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/types/**'],
    },
  },
  resolve: {
    conditions: ['import', 'module', 'browser', 'default'],
    alias: [
      { find: '@', replacement: resolve(__dirname, './src') },
      { find: '@lib', replacement: resolve(__dirname, './src/lib') },
      { find: '@components', replacement: resolve(__dirname, './src/components') },
      { find: '@types', replacement: resolve(__dirname, './src/types') },
      { find: '@config', replacement: resolve(__dirname, './src/config') },
      // Map bare subpath imports to .js paths for @noble/curves v2
{ find: '@noble/curves/secp256k1', replacement: resolve(__dirname, 'node_modules/@noble/curves/secp256k1.js') },
      { find: '@noble/curves/abstract/utils', replacement: resolve(__dirname, 'node_modules/@noble/curves/abstract/utils.js') },
      // FROST: 'ws' alias is ONLY in vite.config.ts for browser builds.
      // vitest uses real 'ws' package (works natively in Node); tests/setup.ts
      // mocks 'ws' for @vbyte/nostr-sdk's top-level import; individual tests
      // replace globalThis.WebSocket with their own loopback transport.
    ],
  },
});
