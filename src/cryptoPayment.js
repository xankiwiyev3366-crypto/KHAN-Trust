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
import { planUsdAmount } from './lib/pricing.js';

const PAYMENT_WALLET = import.meta.env.VITE_KHAN_PAYMENT_WALLET || '';

// Solana SPL tokens accepted for Wallet Connect payments. Both are 6-decimal
// stablecoins, so the same ATA-check / balance-check / transfer-instruction
// branch below (SPL_TOKEN_CONFIG[currency]) handles either one - adding a
// future SPL token only needs an entry here, not a new code path.
const SPL_TOKEN_CONFIG = {
  USDC: {
    mint: import.meta.env.VITE_USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
  },
  USDT: {
    mint: import.meta.env.VITE_USDT_MINT || 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    decimals: 6,
  },
};

const LAMPORTS_PER_SOL = 1_000_000_000;
const AMOUNT_BUFFER = 1.02; // pay slightly above the USD price to clear the backend's tolerance check

// Plan → required USD comes from the shared single source of truth
// (src/lib/pricing.js), the same module the backend verifier reads, so the
// amount charged here and the amount required there can never drift apart.

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

  const requiredUsd = planUsdAmount(plan);
  const transaction = new Transaction();
  transaction.feePayer = publicKey;

  try {
    let receiver;
    try {
      receiver = new PublicKey(PAYMENT_WALLET);
    } catch {
      return { ok: false, status: 'failed', message: 'Payment wallet is misconfigured' };
    }

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

    let amount = 0;
    if (SPL_TOKEN_CONFIG[currency]) {
      const { mint: mintAddress, decimals } = SPL_TOKEN_CONFIG[currency];
      const mint = new PublicKey(mintAddress);
      const senderAta = await getAssociatedTokenAddress(mint, publicKey);
      const receiverAta = await getAssociatedTokenAddress(mint, receiver);

      // If the connected wallet has never held this token, senderAta does
      // not exist on-chain yet - a Transfer instruction pointing at a
      // source account that doesn't exist can't be resolved by Phantom's
      // simulator (this produced "Unable to simulate the result of this
      // request" for USDC before this check existed). Fail fast with a
      // clear message instead of building a transaction that can never
      // succeed, and pre-validate the actual balance too so an
      // underfunded wallet never reaches Phantom either.
      const senderAtaInfo = await connection.getAccountInfo(senderAta);
      if (!senderAtaInfo) {
        return {
          ok: false,
          status: 'no_token_account',
          message: `This wallet has no ${currency} token account yet — send ${currency} to it first or use SOL/Manual Payment.`,
        };
      }

      amount = Math.ceil(requiredUsd * AMOUNT_BUFFER * 10 ** decimals);
      if (!amount) {
        return { ok: false, status: 'failed', message: 'Invalid payment amount' };
      }

      const senderBalance = await connection.getTokenAccountBalance(senderAta, 'confirmed');
      const senderRawBalance = BigInt(senderBalance.value.amount || '0');
      if (senderRawBalance < BigInt(amount)) {
        return { ok: false, status: 'insufficient_balance', message: `Not enough ${currency} for this payment.` };
      }

      const receiverAtaInfo = await connection.getAccountInfo(receiverAta);
      if (!receiverAtaInfo) {
        transaction.add(createAssociatedTokenAccountInstruction(publicKey, receiverAta, receiver, mint));
      }

      transaction.add(createTransferInstruction(senderAta, receiverAta, publicKey, amount, [], TOKEN_PROGRAM_ID));
    } else {
      const solPrice = await getSolUsdPrice();
      if (!solPrice) {
        return { ok: false, status: 'price_unavailable', message: 'Could not fetch the current SOL price, try USDC or the manual method' };
      }
      amount = Math.ceil(((requiredUsd * AMOUNT_BUFFER) / solPrice) * LAMPORTS_PER_SOL);
      if (!amount) {
        return { ok: false, status: 'failed', message: 'Invalid payment amount' };
      }
      transaction.add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: receiver, lamports: amount }));

      // SystemProgram.transfer's only realistic on-chain failure here (valid
      // recipient, valid blockhash, valid fee payer) is the sender not
      // having enough lamports to cover the transfer AND the network fee -
      // the fee is paid by the same feePayer, on top of the transferred
      // amount, and was never checked before. getFeeForMessage asks for the
      // network's actual fee for this exact message rather than guessing,
      // so this turns a doomed transaction into a precise, accurate reason
      // instead of letting simulateTransaction fail generically.
      const feeForMessage = await connection.getFeeForMessage(transaction.compileMessage(), 'confirmed');
      const networkFee = feeForMessage.value ?? 5000;
      const requiredLamports = amount + networkFee;
      const balance = await connection.getBalance(publicKey, 'confirmed');
      if (balance < requiredLamports) {
        return {
          ok: false,
          status: 'insufficient_balance',
          message: `Not enough SOL to cover this payment plus the network fee (need ~${(requiredLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL)`,
        };
      }
    }

    // Run the same simulateTransaction call Phantom runs internally before
    // it opens its approval popup. If this fails, we know definitively the
    // transaction itself (not Phantom, not Blowfish, not domain reputation)
    // is the problem, and exactly which instruction/account caused it -
    // surfaced here instead of as Phantom's generic, undiagnosable message.
    const preflight = await connection.simulateTransaction(transaction);
    if (preflight.value.err) {
      return { ok: false, status: 'simulation_failed', message: 'This transaction would fail on-chain. Please try again or use a different payment method.' };
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
