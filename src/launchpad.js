// Launchpad pure helpers, extracted verbatim from src/main.jsx. Token-amount
// parsing, wallet-address display, and Solana network/explorer config. Depend
// only on i18n translate. The on-chain mint flow (createLaunchpadSplToken) and
// profile builder stay in main.jsx and import these back.
import { translate } from './i18n/index.js';
import { SOLANA_RPC_URL, SOLANA_DEVNET_RPC_URL } from './constants/endpoints.js';

export function parseTokenAmount(value, decimals) {
  const raw = String(value || '').trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error('Total supply must be a positive number.');
  }
  const [wholePart, fractionPart = ''] = raw.split('.');
  if (fractionPart.length > decimals) {
    throw new Error(`Total supply cannot have more than ${decimals} decimal places.`);
  }
  const scale = 10n ** BigInt(decimals);
  const whole = BigInt(wholePart || '0') * scale;
  const fraction = BigInt((fractionPart || '').padEnd(decimals, '0') || '0');
  const amount = whole + fraction;
  if (amount <= 0n) {
    throw new Error('Total supply must be positive.');
  }
  return amount;
}

export function formatWalletAddress(address = '') {
  return address ? `${address.slice(0, 4)}...${address.slice(-4)}` : translate('common.notConnected');
}

export function launchpadNetworkConfig(network = 'devnet') {
  if (network === 'mainnet-beta') {
    return {
      network,
      rpcUrl: SOLANA_RPC_URL,
      label: translate('common.mainnet'),
      explorerCluster: '',
      profileNetwork: 'mainnet-beta',
    };
  }
  return {
    network: 'devnet',
    rpcUrl: SOLANA_DEVNET_RPC_URL,
    label: translate('common.devnet'),
    explorerCluster: '?cluster=devnet',
    profileNetwork: 'devnet',
  };
}

export function solanaExplorerUrl(type, value, network = 'devnet') {
  const config = launchpadNetworkConfig(network);
  const path = type === 'tx' ? 'tx' : 'address';
  return `https://explorer.solana.com/${path}/${value}${config.explorerCluster}`;
}
