import { useEffect, useMemo, useRef, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { setWalletSigner } from '../walletSession.js';

// Module-level (not per-hook-instance) flag for "the user just explicitly
// picked this wallet, please connect it". Every component that calls
// useKhanWallet() mounts the effect below, so this has to be shared rather
// than a per-component ref/state, otherwise each instance would race to
// decide whether a connect attempt is "new". It deliberately resets on every
// page load (it's just a JS module variable) - see the note below for why
// that matters.
let pendingConnectName = null;

// The connect error itself also has to be shared (not per-instance useState):
// several components mount useKhanWallet() at once (nav button, Launchpad,
// the verification modal), but only one of their effects actually wins the
// race to call connect() for a given selection - the others would otherwise
// never see the rejection. Same subscribe/notify shape as src/i18n/index.js.
let sharedConnectError = null;
const errorListeners = new Set();

function setSharedConnectError(error) {
  sharedConnectError = error;
  errorListeners.forEach((listener) => listener(error));
}

// Thin wrapper around the wallet adapter so the rest of the app reads wallet
// state through one hook instead of importing @solana/wallet-adapter-react
// directly everywhere. This is also the intended extension point for future
// KHAN-holder utilities: once the $KHAN token mint address is known, a
// `getKhanBalance()` helper can be added here using `connection` + `publicKey`
// (e.g. via @solana/spl-token's getAssociatedTokenAddress + getAccount) without
// touching any component that calls useKhanWallet(). No holder gating exists
// yet - this only prepares the shape.
// Explicit Phantom/Solflare adapters and their Wallet Standard counterparts
// can both briefly exist while the Standard entry is still registering (see
// WalletContextProvider.jsx) - if a connect() lands in that exact window it
// fails with a WalletNotReadyError carrying no message text. That window is
// normally milliseconds, so one short delayed retry against whatever adapter
// is current by then resolves it without surfacing an error for what is
// really just a timing race, not a real failure.
const NOT_READY_RETRY_DELAY_MS = 350;

export function useKhanWallet() {
  const { connection } = useConnection();
  const { publicKey, connected, connecting, disconnecting, wallet, select, connect, disconnect, wallets, sendTransaction, signMessage } = useWallet();

  const address = useMemo(() => publicKey?.toString() || '', [publicKey]);

  // Register the connected wallet's signMessage so the (non-React) wallet-
  // session helper can prove wallet ownership for premium user-data (P0-1).
  // Cleared when no wallet can sign, so a stale signer is never used.
  useEffect(() => {
    setWalletSigner(connected && typeof signMessage === 'function' ? signMessage : null);
  }, [connected, signMessage]);

  const [connectError, setConnectError] = useState(sharedConnectError);
  useEffect(() => {
    errorListeners.add(setConnectError);
    return () => errorListeners.delete(setConnectError);
  }, []);

  // Always points at the latest `connect` from this render, so the delayed
  // retry below calls connect() bound to whatever wallet is current at retry
  // time rather than a closure frozen at the moment the first attempt failed.
  const connectRef = useRef(connect);
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const connectWithNotReadyRetry = (alreadyRetried = false) => {
    connect().catch((error) => {
      if (error?.name === 'WalletNotReadyError' && !alreadyRetried) {
        setTimeout(() => connectRef.current().catch((retryError) => setSharedConnectError(retryError)), NOT_READY_RETRY_DELAY_MS);
        return;
      }
      setSharedConnectError(error);
    });
  };

  // select(name) only marks an adapter as active; it does not itself open the
  // extension's approval popup. Connecting must happen in a follow-up effect
  // once `wallet` updates to the newly selected adapter - calling connect()
  // synchronously right after select() would still read the previous (often
  // null) adapter from this render's closure.
  //
  // This effect ONLY fires for a wallet picked via selectAndConnect() this
  // session (pendingConnectName matches) - it must NOT also fire for a wallet
  // adapter restored from localStorage on page load. Some adapters (Solflare)
  // redirect to an install/web-wallet page on connect() when the extension
  // isn't detected; if this effect auto-connected on every mount, a user who
  // once clicked Solflare without the extension installed would get
  // redirected again on every single page load thereafter, since the wallet
  // name persists in localStorage regardless of whether connecting actually
  // succeeded. Real session restoration for genuinely installed wallets is
  // handled separately by WalletProvider's own `autoConnect` prop.
  useEffect(() => {
    if (!wallet || connected || connecting) return;
    if (pendingConnectName !== wallet.adapter.name) return;
    pendingConnectName = null;
    connectWithNotReadyRetry();
  }, [wallet, connected, connecting, connect]);

  const selectAndConnect = (walletName) => {
    setSharedConnectError(null);
    if (wallet?.adapter?.name === walletName) {
      // Re-clicking the wallet that's already active (e.g. retrying after a
      // previous failed attempt) - select(walletName) would be a no-op since
      // nothing changes, so the effect above would never re-fire. Call
      // connect() directly instead of routing through the pending-flag effect.
      connectWithNotReadyRetry();
      return;
    }
    pendingConnectName = walletName;
    select(walletName);
  };

  return {
    address,
    publicKey,
    connected,
    connecting,
    disconnecting,
    walletName: wallet?.adapter?.name || '',
    adapter: wallet?.adapter || null,
    availableWallets: wallets,
    select,
    selectAndConnect,
    connect,
    disconnect,
    sendTransaction,
    connectError,
    connection,
    // Placeholder for future KHAN balance checks - intentionally unimplemented.
    // getKhanBalance: async () => null,
  };
}
