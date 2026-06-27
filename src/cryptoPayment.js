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
    if (currency === 'USDC') {
      const mint = new PublicKey(USDC_MINT);
      const senderAta = await getAssociatedTokenAddress(mint, publicKey);
      const receiverAta = await getAssociatedTokenAddress(mint, receiver);

      // The sender's USDC token account was never checked before. If the
      // connected wallet has never held USDC, senderAta does not exist
      // on-chain yet - a Transfer instruction pointing at a source account
      // that doesn't exist can't be resolved by Phantom's simulator, which
      // is consistent with "Unable to simulate the result of this request"
      // appearing only for the USDC path. Fail fast with a clear message
      // instead of building a transaction that can never succeed.
      const senderAtaInfo = await connection.getAccountInfo(senderAta);
      if (!senderAtaInfo) {
        return { ok: false, status: 'no_usdc_account', message: 'This wallet has no USDC token account yet - pay with SOL or send USDC to it first' };
      }

      const receiverAtaInfo = await connection.getAccountInfo(receiverAta);
      if (!receiverAtaInfo) {
        transaction.add(createAssociatedTokenAccountInstruction(publicKey, receiverAta, receiver, mint));
      }

      amount = Math.ceil(requiredUsd * AMOUNT_BUFFER * 10 ** USDC_DECIMALS);
      if (!amount) {
        return { ok: false, status: 'failed', message: 'Invalid payment amount' };
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

    // Temporary diagnostic logging (production debugging only - no secrets,
    // every value here is already public on-chain data). Safe to remove
    // once the "Unable to simulate" report is confirmed resolved.
    console.log('[KHAN Trust] payment tx preflight', {
      currency,
      amount,
      feePayer: transaction.feePayer?.toBase58(),
      receiver: receiver.toBase58(),
      recentBlockhash: transaction.recentBlockhash,
      instructionCount: transaction.instructions.length,
      programIds: transaction.instructions.map((ix) => ix.programId.toBase58()),
    });

    // Run the same simulateTransaction call Phantom runs internally before
    // it opens its approval popup. If this fails, we know definitively the
    // transaction itself (not Phantom, not Blowfish, not domain reputation)
    // is the problem, and exactly which instruction/account caused it -
    // surfaced here instead of as Phantom's generic, undiagnosable message.
    const preflight = await connection.simulateTransaction(transaction);
    if (preflight.value.err) {
      console.error('[KHAN Trust] payment tx simulation failed', {
        err: preflight.value.err,
        logs: preflight.value.logs,
      });
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
