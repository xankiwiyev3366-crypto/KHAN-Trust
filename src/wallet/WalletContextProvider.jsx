import React, { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';

const MAINNET_RPC_URL = 'https://api.mainnet-beta.solana.com';

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

// Single shared wallet connection for the whole site (nav "Connect Wallet").
// This is intentionally separate from the page-specific Phantom signing flows
// in Launchpad (mint a token) and the verification modal (sign an ownership
// message) - those need a specific signature for a specific action and stay
// as-is. This provider is the one general "who is connected" identity layer,
// and is where future KHAN-holder checks (e.g. SPL balance lookups) should
// read the connected publicKey from - see src/wallet/useKhanWallet.js.
export default function WalletContextProvider({ children }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={MAINNET_RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect={shouldAutoConnect} onError={() => {}}>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
