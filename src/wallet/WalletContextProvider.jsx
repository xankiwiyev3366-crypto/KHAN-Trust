import React from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletReadyState } from '@solana/wallet-adapter-base';

// api.mainnet-beta.solana.com rejects many browser-origin requests with HTTP
// 403 (getAccountInfo, sendTransaction, confirmTransaction all hit this) -
// it's only usable as a last-resort fallback. Production should set
// VITE_SOLANA_RPC_URL to a provider that allows browser/CORS traffic
// (Helius, QuickNode, Triton, etc).
const MAINNET_RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Only auto-reconnect a wallet that is genuinely installed as a browser
// extension. Solflare's adapter (and some others) treat "Loadable" as "not
// installed, but connect() will redirect the user to install/use it" - if we
// auto-connect for Loadable too, a user who once clicked Solflare without the
// extension gets redirected to solflare.com on every single page load
// thereafter, since the wallet name is persisted to localStorage regardless
// of whether the connection actually completed. Restricting auto-connect to
// Installed avoids that loop while still restoring a real prior session.
function shouldAutoConnect(adapter) {
  return adapter.readyState === WalletReadyState.Installed;
}

// No explicit wallets array. Phantom and Solflare have both implemented the
// Wallet Standard for years, so they self-register into the browser's
// wallet-standard registry and @solana/wallet-adapter-react picks them up
// automatically (via useStandardWalletAdapters internally) - no adapter
// instance, no manual readyState polling needed.
//
// We used to pass explicit PhantomWalletAdapter/SolflareWalletAdapter
// instances here, which caused two real, separate bugs once a tester's
// browser also had Phantom registered as a Standard Wallet:
//   1. @solana/wallet-adapter-phantom's own legacy `isPhantomInstalled`
//      detection (added in 0.9.29, fixed in our deployed 0.9.28 pin) showed
//      a genuinely installed Phantom as "not installed".
//   2. Once the Standard Wallet entry registers, the SDK silently drops the
//      explicit legacy adapter from the wallets list (same name, so it's
//      treated as a duplicate) and swaps in the Standard one - if a connect
//      attempt was already in flight against the legacy adapter when that
//      swap happened, it surfaced as a generic "Could not connect wallet"
//      error with no useful detail (logged a one-line SDK console.warn
//      about it, easy to miss).
// Standard Wallet detection has neither failure mode: there is no polling
// gate to regress, and there is nothing to swap out from under an in-flight
// connection because it's the only adapter for that wallet name from the
// start. Keep an empty array (not undefined) so the WalletProvider prop
// type stays explicit.
const EXPLICIT_WALLETS = [];

// Single shared wallet connection for the whole site (nav "Connect Wallet").
// This is intentionally separate from the page-specific Phantom signing flows
// in Launchpad (mint a token) and the verification modal (sign an ownership
// message) - those need a specific signature for a specific action and stay
// as-is. This provider is the one general "who is connected" identity layer,
// and is where future KHAN-holder checks (e.g. SPL balance lookups) should
// read the connected publicKey from - see src/wallet/useKhanWallet.js.
export default function WalletContextProvider({ children }) {
  return (
    <ConnectionProvider endpoint={MAINNET_RPC_URL}>
      <WalletProvider
        wallets={EXPLICIT_WALLETS}
        autoConnect={shouldAutoConnect}
        onError={(error) => console.error('[KHAN Trust] wallet connection error:', error)}
      >
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
