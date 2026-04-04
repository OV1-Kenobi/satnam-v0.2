import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**/*.ts', 'netlify/functions/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/types/**'],
    },
  },
  resolve: {
    conditions: ['import', 'module', 'browser', 'default'],
    alias: {
      '@': resolve(__dirname, './src'),
      '@lib': resolve(__dirname, './src/lib'),
      '@components': resolve(__dirname, './src/components'),
      '@types': resolve(__dirname, './src/types'),
      '@config': resolve(__dirname, './src/config'),
      // Map bare subpath imports to .js paths for @noble/curves v2
      '@noble/curves/secp256k1': resolve(__dirname, 'node_modules/@noble/curves/secp256k1.js'),
      '@noble/curves/abstract/utils': resolve(__dirname, 'node_modules/@noble/curves/abstract/utils.js'),
    },
  },
});
