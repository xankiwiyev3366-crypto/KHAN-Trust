import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// @solana/web3.js and @solana/spl-token reference the Node "Buffer" global at
// module scope. Vite's dev-mode dependency pre-bundling does not polyfill
// Node globals automatically, which crashes the app on load with
// "Buffer is not defined" whenever the dep cache is rebuilt from scratch.
// The production build tree-shakes around it, so this only bites `vite dev`.
// Split the big third-party libraries out of the single ~1.4MB app bundle
// (Phase 3 perf). This does NOT change any behaviour - it only tells Rollup
// which output file each dependency lands in, so:
//   - the huge Solana wallet/web3 stack, React, icons and Stripe become their
//     own chunks that download in parallel and are cached independently, and
//   - a change to app code no longer busts the (rarely-changing) vendor chunks
//     on repeat visits.
// jspdf / html2canvas / dompurify are deliberately NOT assigned here so they
// stay in their existing async (lazy-loaded) chunks and aren't pulled eager.
function manualChunks(id) {
  if (!id.includes('node_modules')) return undefined;
  // Keep already-lazy heavy libs as their own async chunks.
  if (id.includes('jspdf') || id.includes('html2canvas') || id.includes('dompurify') || id.includes('/purify')) {
    return undefined;
  }
  // Solana wallet + web3 + its crypto deps (only needed once a wallet connects).
  if (
    id.includes('@solana') || id.includes('/web3.js') || id.includes('spl-token') ||
    id.includes('wallet-adapter') || id.includes('bs58') || id.includes('tweetnacl') ||
    id.includes('bn.js') || id.includes('borsh') || id.includes('/buffer/') || id.includes('bigint-buffer')
  ) {
    return 'solana';
  }
  if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react-vendor';
  if (id.includes('lucide-react')) return 'icons';
  if (id.includes('stripe')) return 'stripe';
  return 'vendor';
}

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
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
});
