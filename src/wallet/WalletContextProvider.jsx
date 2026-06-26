import React, { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';

// api.mainnet-beta.solana.com rejects many browser-origin requests with HTTP
// 403 (getAccountInfo, sendTransaction, confirmTransaction all hit this) -
// it's only usable as a last-resort fallback. Production should set
// VITE_SOLANA_RPC_URL to a provider that allows browser/CORS traffic
// (Helius, QuickNode, Triton, etc).
const MAINNET_RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Only auto-reconnect a wallet that is genuinely installed/ready. Solflare's
// adapter (and some others) treat "Loadable" as "not installed, but
// connect() will redirect the user to install/use it" - if we auto-connect
// for Loadable too, a user who once clicked Solflare without the extension
// gets redirected to solflare.com on every single page load thereafter,
// since the wallet name is persisted to localStorage regardless of whether
// the connection actually completed. Restricting auto-connect to Installed
// avoids that loop while still restoring a real prior session.
function shouldAutoConnect(adapter) {
  return adapter.readyState === WalletReadyState.Installed;
}

// Explicit Phantom/Solflare adapters are kept here (pinned to known-good
// versions - see package.json) specifically for what Wallet Standard
// auto-detection alone cannot do:
//   - iOS Safari: PhantomWalletAdapter reports `Loadable` readyState and its
//     connect() deep-links into Phantom's in-app browser
//     (phantom.app/ul/browse/...). There is no browser extension API to
//     register via the Wallet Standard on iOS Safari at all, so without this
//     explicit adapter iOS users have no way to reach Phantom from a normal
//     mobile tab.
//   - Desktop, no extension installed: the explicit adapter's `NotDetected`
//     state drives the "Phantom not installed" prompt (see
//     ConnectWalletButton.jsx) instead of the wallet simply being absent
//     from the list.
// On desktop WITH the extension installed, @solana/wallet-adapter-react's
// useStandardWalletAdapters() detects Phantom/Solflare's Wallet Standard
// registration and transparently prefers that over the explicit adapter of
// the same name (no duplicate entries). That auto-merge is also what
// resolves @solana/wallet-adapter-phantom@0.9.29's `isPhantomInstalled`
// detection regression - we additionally pin to the last known-good 0.9.28
// (see package.json) so the explicit adapter itself reports correctly too,
// rather than depending solely on the Standard Wallet entry winning the race.
const wallets = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];

// Single shared wallet connection for the whole site (nav "Connect Wallet").
// This is intentionally separate from the page-specific Phantom signing flows
// in Launchpad (mint a token) and the verification modal (sign an ownership
// message) - those need a specific signature for a specific action and stay
// as-is. This provider is the one general "who is connected" identity layer,
// and is where future KHAN-holder checks (e.g. SPL balance lookups) should
// read the connected publicKey from - see src/wallet/useKhanWallet.js.
export default function WalletContextProvider({ children }) {
  // useMemo so the adapter instances (and their internal detection polling)
  // are created once per app lifetime, not re-created on every render.
  const memoWallets = useMemo(() => wallets, []);

  return (
    <ConnectionProvider endpoint={MAINNET_RPC_URL}>
      <WalletProvider
        wallets={memoWallets}
        autoConnect={shouldAutoConnect}
        onError={(error) => console.error('[KHAN Trust] wallet connection error:', error)}
      >
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
