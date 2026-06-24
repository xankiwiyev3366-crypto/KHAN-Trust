import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// @solana/web3.js and @solana/spl-token reference the Node "Buffer" global at
// module scope. Vite's dev-mode dependency pre-bundling does not polyfill
// Node globals automatically, which crashes the app on load with
// "Buffer is not defined" whenever the dep cache is rebuilt from scratch.
// The production build tree-shakes around it, so this only bites `vite dev`.
export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      buffer: 'buffer',
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
      inject: ['./src/bufferShim.js'],
    },
  },
});
