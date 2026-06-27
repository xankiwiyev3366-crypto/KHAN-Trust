// Wallet Connect payment flow: builds and sends a USDC or SOL transfer
// directly from the connected Phantom/Solflare wallet to the KHAN Trust
// payment wallet, then hands the resulting signature to the same
// verify-solana-payment endpoint the manual tx-hash flow uses. Verification
// (and entitlement granting) stays server-side and identical either way -
// this module only replaces "go send money yourself, then paste the hash"
// with "approve the prebuilt transaction".
import {
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import { verifySolanaPayment } from './solanaVerify.js';

const PAYMENT_WALLET = import.meta.env.VITE_KHAN_PAYMENT_WALLET || '';
const USDC_MINT = import.meta.env.VITE_USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS = 6;
const LAMPORTS_PER_SOL = 1_000_000_000;
const AMOUNT_BUFFER = 1.02; // pay slightly above the USD price to clear the backend's tolerance check

const PLAN_USD_AMOUNT = {
  premium: 9,
  early_supporter: 29,
};

const SOL_PRICE_SOURCES = [
  { url: 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', extract: (data) => data?.solana?.usd },
  { url: 'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT', extract: (data) => Number(data?.price) },
];

export function isWalletPaymentConfigured() {
  return Boolean(PAYMENT_WALLET);
}

export async function getSolUsdPrice() {
  for (const source of SOL_PRICE_SOURCES) {
    try {
      const response = await fetch(source.url);
      if (!response.ok) continue;
      const data = await response.json();
      const price = source.extract(data);
      if (typeof price === 'number' && price > 0) return price;
    } catch {
      // try the next source
    }
  }
  return null;
}

export async function payWithConnectedWallet({ connection, publicKey, sendTransaction, plan, currency }) {
  if (!isWalletPaymentConfigured()) {
    return { ok: false, status: 'not_configured', message: 'Wallet payments are not configured yet' };
  }
  if (!publicKey) {
    return { ok: false, status: 'no_wallet', message: 'Connect a wallet first' };
  }

  const requiredUsd = PLAN_USD_AMOUNT[plan] || PLAN_USD_AMOUNT.premium;
  const receiver = new PublicKey(PAYMENT_WALLET);
  const transaction = new Transaction();
  transaction.feePayer = publicKey;

  try {
    // Phantom simulates the transaction (via its own simulateTransaction
    // call) before showing the approval popup, and that simulation requires
    // a valid recentBlockhash already bound into the message. Without it
    // set explicitly here, whether it gets filled in - and with what - is
    // left to wallet-adapter/wallet-standard internals, which can vary by
    // code path and has produced "Unable to simulate the result of this
    // request" in Phantom. Fetching and setting it ourselves removes that
    // ambiguity; lastValidBlockHeight is kept alongside it so the
    // confirmation below can use the non-deprecated, more reliable
    // {signature, blockhash, lastValidBlockHeight} form.
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;

    if (currency === 'USDC') {
      const mint = new PublicKey(USDC_MINT);
      const senderAta = await getAssociatedTokenAddress(mint, publicKey);
      const receiverAta = await getAssociatedTokenAddress(mint, receiver);

      const receiverAtaInfo = await connection.getAccountInfo(receiverAta);
      if (!receiverAtaInfo) {
        transaction.add(createAssociatedTokenAccountInstruction(publicKey, receiverAta, receiver, mint));
      }

      const amount = Math.ceil(requiredUsd * AMOUNT_BUFFER * 10 ** USDC_DECIMALS);
      transaction.add(createTransferInstruction(senderAta, receiverAta, publicKey, amount, [], TOKEN_PROGRAM_ID));
    } else {
      const solPrice = await getSolUsdPrice();
      if (!solPrice) {
        return { ok: false, status: 'price_unavailable', message: 'Could not fetch the current SOL price, try USDC or the manual method' };
      }
      const lamports = Math.ceil(((requiredUsd * AMOUNT_BUFFER) / solPrice) * LAMPORTS_PER_SOL);
      transaction.add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: receiver, lamports }));
    }

    const signature = await sendTransaction(transaction, connection);
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

    const result = await verifySolanaPayment({ transactionHash: signature, plan });
    return { ok: result.status === 'verified', status: result.status, message: result.message, transactionHash: signature, debug: result.debug };
  } catch (error) {
    const message = String(error?.message || error || '');
    if (/reject|denied|cancel/i.test(message)) {
      return { ok: false, status: 'rejected', message: 'Transaction was rejected in the wallet' };
    }
    return { ok: false, status: 'failed', message: message || 'Payment failed' };
  }
}
