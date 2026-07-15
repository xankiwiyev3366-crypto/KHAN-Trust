import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

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
    // Emitted so scripts/verify-boundary.mjs can walk the real chunk graph
    // (entry -> imports -> dynamicImports) instead of guessing which files the
    // user bundle actually pulls in.
    manifest: true,
    rollupOptions: {
      // TWO SEPARATE APPLICATIONS, one build.
      //
      //   index.html -> src/main.jsx       the public KHAN Trust app
      //   admin.html -> src/admin/...      the private operator console
      //
      // This split is the load-bearing privacy boundary for the Growth OS: a
      // module reachable only from the admin entry is emitted only into admin
      // chunks, so no admin route name, label, metric, or strategy string ever
      // lands in the JS a visitor downloads. Rollup only hoists a module into a
      // shared chunk when BOTH entries import it - which, by design, is limited
      // to React/vendor code and the stylesheet.
      //
      // The invariant this depends on: src/main.jsx (and anything it imports)
      // must NEVER import from src/admin/. `npm run verify:boundary` asserts
      // exactly that against the built output, so an accidental import that
      // would leak the console into the user bundle fails the build instead of
      // shipping silently.
      input: {
        main: resolve(process.cwd(), 'index.html'),
        admin: resolve(process.cwd(), 'admin.html'),
      },
      output: {
        manualChunks,
      },
    },
  },
});
