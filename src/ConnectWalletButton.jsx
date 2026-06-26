import React, { useEffect, useRef, useState } from 'react';
import { Wallet, Copy, ExternalLink, LogOut, CheckCircle2, AlertTriangle, Star } from 'lucide-react';
import { useTranslation } from './i18n/I18nContext.jsx';
import { useKhanWallet } from './wallet/useKhanWallet.js';
import { fetchEntitlement, isEarlySupporter } from './entitlements.js';

function truncate(address) {
  return address ? `${address.slice(0, 4)}...${address.slice(-4)}` : '';
}

// Official download links for the wallets we explicitly support (see
// WalletContextProvider.jsx) - used to turn a disabled "not installed" entry
// into an actionable link instead of a dead button.
const WALLET_DOWNLOAD_URLS = {
  Phantom: 'https://phantom.com/download',
  Solflare: 'https://solflare.com/download',
};

function connectErrorKey(error) {
  if (!error) return '';
  // WalletNotReadyError/WalletNotSelectedError carry no message text (they're
  // thrown with `new Error()` and no args) - identify them by name, not by
  // matching against an empty string.
  if (error?.name === 'WalletNotReadyError' || error?.name === 'WalletNotSelectedError') return 'walletConnect.notReady';
  const message = String(error?.message || error || '');
  if (/reject|denied|cancel/i.test(message)) return 'walletConnect.rejected';
  return 'walletConnect.failed';
}

export default function ConnectWalletButton({ variant = 'desktop' }) {
  const { t } = useTranslation();
  const { address, connected, connecting, walletName, availableWallets, selectAndConnect, disconnect, connectError } = useKhanWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isEarly, setIsEarly] = useState(false);
  const rootRef = useRef(null);
  const errorKey = connectErrorKey(connectError);

  // Whichever wallet identity area is visible site-wide doubles as the
  // closest thing this app has to a "profile" - an Early Supporter's badge
  // belongs here so it's visible everywhere, not just on the pricing page.
  useEffect(() => {
    if (!connected || !address) {
      setIsEarly(false);
      return;
    }
    fetchEntitlement(address).then((entitlement) => setIsEarly(isEarlySupporter(entitlement)));
  }, [connected, address]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (connected) setOpen(false);
  }, [connected]);

  const pickWallet = (walletAdapterName) => {
    selectAndConnect(walletAdapterName);
  };

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
    } finally {
      setOpen(false);
    }
  };

  return (
    <div className={`wallet-connect ${variant}`} ref={rootRef}>
      <button
        type="button"
        className={connected ? 'wallet-connect-trigger connected' : 'wallet-connect-trigger'}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={connected ? t('walletConnect.connected') : t('walletConnect.connect')}
      >
        <Wallet size={16} />
        <span>{connecting ? t('walletConnect.connecting') : connected ? truncate(address) : t('walletConnect.connect')}</span>
        {connected && isEarly && (
          <span className="early-supporter-badge compact" title={t('earlySupporter.badgeTooltip')}>
            <Star size={11} />
          </span>
        )}
      </button>

      {open && (
        <div className="wallet-connect-menu" role="menu">
          {connected ? (
            <>
              <div className="wallet-connect-address-row">
                <CheckCircle2 size={16} className="gold-icon" />
                <div>
                  <strong>{walletName}</strong>
                  <span>{truncate(address)}</span>
                </div>
              </div>
              {isEarly && (
                <span className="early-supporter-badge" title={t('earlySupporter.badgeTooltip')}>
                  <Star size={14} /> {t('earlySupporter.badgeLabel')}
                </span>
              )}
              <button type="button" onClick={copyAddress}>
                <Copy size={15} /> {copied ? t('common.copied') : t('walletConnect.copyAddress')}
              </button>
              <a
                href={`https://explorer.solana.com/address/${address}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => setOpen(false)}
              >
                <ExternalLink size={15} /> {t('walletConnect.viewOnExplorer')}
              </a>
              <button type="button" className="wallet-connect-disconnect" onClick={handleDisconnect}>
                <LogOut size={15} /> {t('walletConnect.disconnect')}
              </button>
            </>
          ) : (
            <>
              <span className="wallet-connect-menu-label">{t('walletConnect.chooseWallet')}</span>
              {availableWallets.map((item) => {
                const notReady = item.readyState === 'NotDetected' || item.readyState === 'Unsupported';
                const downloadUrl = WALLET_DOWNLOAD_URLS[item.adapter.name];

                // A wallet we explicitly support but that isn't detected gets
                // a real link to its official download page (and the clear
                // "not installed" message below) instead of a disabled,
                // unactionable button.
                if (notReady && downloadUrl) {
                  return (
                    <a key={item.adapter.name} href={downloadUrl} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
                      {item.adapter.icon && <img src={item.adapter.icon} alt="" width={18} height={18} />}
                      <span>{item.adapter.name}</span>
                      <small>{t('walletConnect.install')}</small>
                    </a>
                  );
                }

                return (
                  <button
                    key={item.adapter.name}
                    type="button"
                    disabled={notReady}
                    onClick={() => pickWallet(item.adapter.name)}
                  >
                    {item.adapter.icon && <img src={item.adapter.icon} alt="" width={18} height={18} />}
                    <span>{item.adapter.name}</span>
                    {notReady && <small>{t('walletConnect.install')}</small>}
                  </button>
                );
              })}
              {availableWallets.some(
                (item) => item.adapter.name === 'Phantom' && (item.readyState === 'NotDetected' || item.readyState === 'Unsupported')
              ) && <p className="wallet-connect-not-installed-note">{t('walletConnect.notInstalled', { wallet: 'Phantom' })}</p>}
              {errorKey && (
                <p className="wallet-connect-error">
                  <AlertTriangle size={14} /> {t(errorKey)}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
