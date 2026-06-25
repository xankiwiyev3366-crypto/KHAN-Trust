import React, { useEffect, useRef, useState } from 'react';
import { Wallet, Copy, ExternalLink, LogOut, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useTranslation } from './i18n/I18nContext.jsx';
import { useKhanWallet } from './wallet/useKhanWallet.js';

function truncate(address) {
  return address ? `${address.slice(0, 4)}...${address.slice(-4)}` : '';
}

function connectErrorKey(error) {
  if (!error) return '';
  const message = String(error?.message || error || '');
  if (/reject|denied|cancel/i.test(message)) return 'walletConnect.rejected';
  return 'walletConnect.failed';
}

export default function ConnectWalletButton({ variant = 'desktop' }) {
  const { t } = useTranslation();
  const { address, connected, connecting, walletName, availableWallets, selectAndConnect, disconnect, connectError } = useKhanWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef(null);
  const errorKey = connectErrorKey(connectError);

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
              {availableWallets.map((item) => (
                <button
                  key={item.adapter.name}
                  type="button"
                  disabled={item.readyState === 'NotDetected' || item.readyState === 'Unsupported'}
                  onClick={() => pickWallet(item.adapter.name)}
                >
                  {item.adapter.icon && <img src={item.adapter.icon} alt="" width={18} height={18} />}
                  <span>{item.adapter.name}</span>
                  {(item.readyState === 'NotDetected' || item.readyState === 'Unsupported') && (
                    <small>{t('walletConnect.install')}</small>
                  )}
                </button>
              ))}
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
