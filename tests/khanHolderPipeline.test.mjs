// KHAN holder analytics: the sync pipeline, its timestamps, Asia/Baku days, and
// the live market data - against a simulated chain and simulated price APIs.
//
// 2026-09 incident, which these pin: the admin page showed July as "latest"
// because khan-holders-sync was never scheduled (its schedule lived only in
// `export const config`, which Netlify ignores for Lambda-style handlers) and
// the ledger only moved on a manual refresh; holder-count notifications carried
// the time a sync ran rather than the buy that caused them; "today" was the UTC
// day; SOL/USD came from one provider that throttles cloud IPs and was not even
// returned by the stats endpoint; and KHAN's $0.0000035 price rendered as $0.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.HELIUS_API_KEY = 'test-key'; // no inter-request delay in the indexer
process.env.KHAN_ADMIN_PASSCODE = 'test-passcode';
process.env.URL = 'https://khantrust.test';

class FakeStore {
  constructor() { this.data = new Map(); this.writes = 0; }
  async setJSON(key, value) { this.writes += 1; this.data.set(key, JSON.parse(JSON.stringify(value))); }
  async get(key) { return this.data.has(key) ? JSON.parse(JSON.stringify(this.data.get(key))) : null; }
  async delete(key) { this.data.delete(key); }
  async list() { return { blobs: Array.from(this.data.keys()).map((key) => ({ key })) }; }
}
const stores = new Map();
const storeFor = (name) => {
  if (!stores.has(name)) stores.set(name, new FakeStore());
  return stores.get(name);
};
mock.module('../netlify/functions/_blobsClient.mjs', {
  namedExports: {
    getNamedStore: (name) => storeFor(name),
    jsonResponse: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  },
});

const { KHAN_MINT, runSyncBatch } = await import('../netlify/functions/_khanIndexer.mjs');
const { deriveBondingCurvePda, decodeBondingCurve, getKhanMarket, getSolUsdQuote, resetMarketCache } = await import('../netlify/functions/_khanMarket.mjs');
const { computeHolderStats, buildGrowthSeries, buildDailySeries, withEventTimes, withinRange } = await import('../netlify/functions/_khanHolderAnalytics.mjs');
const { issueToken } = await import('../netlify/functions/_adminAuth.mjs');
const { handler: cronHandler } = await import('../netlify/functions/khan-holders-sync.mjs');
const { handler: backgroundHandler } = await import('../netlify/functions/khan-holders-sync-background.mjs');
const { handler: statsHandler } = await import('../netlify/functions/khan-holders-admin-stats.mjs');
const { bakuDayKey, startOfBakuDay, formatBakuDateTime } = await import('../src/lib/bakuTime.js');
const { formatUsdAmount } = await import('../src/lib/formatPrice.js');

const CURVE = deriveBondingCurvePda(KHAN_MINT);
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const W = { a: 'WalletA1111111111111111111111111111111111111', b: 'WalletB1111111111111111111111111111111111111', c: 'WalletC1111111111111111111111111111111111111' };
const at = (iso) => Date.parse(iso);

// ── simulated chain ─────────────────────────────────────────────────────────
function curveAccount({ vt = 1046692226795823n, vs = 30754026054n, rt = 766792226795823n, rs = 754026054n, complete = 0 } = {}) {
  const b = Buffer.alloc(151);
  Buffer.from('17b7f83760d8ac60', 'hex').copy(b, 0);
  b.writeBigUInt64LE(vt, 8); b.writeBigUInt64LE(vs, 16); b.writeBigUInt64LE(rt, 24); b.writeBigUInt64LE(rs, 32);
  b.writeBigUInt64LE(1000000000000000n, 40); b[48] = complete;
  return b.toString('base64');
}

let chain;
function resetChain() {
  chain = { txs: [], byId: new Map(), balances: new Map(), curve: curveAccount(), pairs: [pumpPair()], price: { coingecko: 120.95, coinbase: 120.98, kraken: 120.99 }, fail: new Set(), rpcCalls: [] };
}
function pumpPair(priceUsd = '0.000003544') {
  return { dexId: 'pumpfun', pairAddress: CURVE, priceUsd, priceNative: '0.00000002938', liquidity: { usd: 0 } };
}

let sigCounter = 0;
// Appends a real-shaped parsed transaction; newest last. Returns its signature.
function trade(wallet, direction, khan, sol, iso, { failed = false } = {}) {
  sigCounter += 1;
  const signature = `sig${String(sigCounter).padStart(4, '0')}`;
  const pre = chain.balances.get(wallet) || 0;
  const post = failed ? pre : direction === 'buy' ? pre + khan : pre - khan;
  if (!failed) chain.balances.set(wallet, post);
  const lamports = Math.round(sol * 1e9);
  const fee = 5000;
  const walletPre = 10e9;
  const walletPost = failed ? walletPre - fee : direction === 'buy' ? walletPre - lamports - fee : walletPre + lamports - fee;
  const tx = {
    blockTime: Math.floor(at(iso) / 1000),
    meta: {
      err: failed ? { InstructionError: [0, 'x'] } : null, fee,
      preBalances: [walletPre, 0], postBalances: [walletPost, 0],
      preTokenBalances: [{ accountIndex: 2, mint: KHAN_MINT, owner: wallet, uiTokenAmount: { uiAmount: pre } }, { accountIndex: 3, mint: KHAN_MINT, owner: CURVE, uiTokenAmount: { uiAmount: 5e8 } }],
      postTokenBalances: [{ accountIndex: 2, mint: KHAN_MINT, owner: wallet, uiTokenAmount: { uiAmount: post } }, { accountIndex: 3, mint: KHAN_MINT, owner: CURVE, uiTokenAmount: { uiAmount: 5e8 - (post - pre) } }],
    },
    transaction: { signatures: [signature], message: { accountKeys: [wallet, CURVE, `${wallet}-ata`, `${CURVE}-ata`] } },
  };
  chain.txs.push({ signature, blockTime: tx.blockTime, err: tx.meta.err });
  chain.byId.set(signature, tx);
  return signature;
}

function rpc(method, params) {
  chain.rpcCalls.push(method);
  if (method === 'getSignaturesForAddress') {
    const [, { limit, before }] = params;
    const newestFirst = chain.txs.slice().reverse();
    const start = before ? newestFirst.findIndex((t) => t.signature === before) + 1 : 0;
    return newestFirst.slice(start, start + limit);
  }
  if (method === 'getTransaction') return chain.byId.get(params[0]) || null;
  if (method === 'getAccountInfo') {
    if (params[0] === KHAN_MINT) return { value: { owner: TOKEN_2022 } };
    if (params[0] === CURVE) return chain.fail.has('curve') ? null : { value: { owner: PUMP, data: [chain.curve, 'base64'] } };
    return { value: null };
  }
  if (method === 'getProgramAccounts') {
    return Array.from(chain.balances.entries()).map(([owner, amount]) => ({ account: { data: { parsed: { info: { owner, tokenAmount: { uiAmount: amount } } } } } }));
  }
  if (method === 'getTokenSupply') return { value: { uiAmount: 1e9 } };
  throw new Error(`unexpected rpc ${method}`);
}

const outbound = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  outbound.push({ url: u, init });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (u.includes('helius-rpc.com') || u.includes('api.mainnet-beta')) {
    const body = JSON.parse(init.body);
    if (body.method === 'getAccountInfo' && body.params[0] === CURVE && chain.fail.has('curve')) return json({ error: { message: 'boom' } });
    return json({ jsonrpc: '2.0', id: body.id, result: rpc(body.method, body.params) });
  }
  if (u.includes('api.dexscreener.com')) return chain.fail.has('dex') ? json({}, 503) : json({ pairs: chain.pairs });
  if (u.includes('coingecko.com/api/v3/simple')) return chain.fail.has('coingecko') ? json({ status: 'throttled' }, 429) : json({ solana: { usd: chain.price.coingecko } });
  if (u.includes('coingecko.com/api/v3/coins/solana/market_chart')) return chain.fail.has('coingecko') ? json({}, 429) : json({ prices: [[0, 150]] });
  if (u.includes('api.coinbase.com')) return chain.fail.has('coinbase') ? json({}, 500) : json({ data: { amount: String(chain.price.coinbase) } });
  if (u.includes('api.kraken.com/0/public/Ticker')) return chain.fail.has('kraken') ? json({}, 500) : json({ error: [], result: { SOLUSD: { c: [String(chain.price.kraken), '1'] } } });
  if (u.includes('api.kraken.com/0/public/OHLC')) {
    const since = Number(new URL(u).searchParams.get('since')) + 1;
    return json({ error: [], result: { SOLUSD: [[since, '1', '1', '1', '140', '141.5', '1', 1]], last: since } });
  }
  if (u.includes('/.netlify/functions/khan-holders-sync-background')) return new Response('', { status: 202 });
  throw new Error(`unexpected fetch ${u}`);
};

function holderStore() { return storeFor('khan-holder-analytics'); }
async function ledger() {
  const s = holderStore();
  return { tx: (await s.get('transactions.json')) || [], holders: (await s.get('holders.json')) || {}, alerts: (await s.get('alerts.json')) || [], meta: (await s.get('meta.json')) || {} };
}
function reset() {
  stores.clear();
  resetChain();
  resetMarketCache();
  outbound.length = 0;
}
async function syncToHead(trigger = 'test') {
  let result;
  let guard = 0;
  do { result = await runSyncBatch({ trigger, runId: `${trigger}-run` }); guard += 1; } while (!result.reachedHead && guard < 20);
  return result;
}

// ── 1. scheduled path ───────────────────────────────────────────────────────

test('the sync schedule is registered in netlify.toml, where Netlify actually reads it', () => {
  const toml = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');
  assert.match(toml, /\[functions\."khan-holders-sync"\]\s*\n\s*schedule = "\*\/10 \* \* \* \*"/);
});

test('scheduled tick fires the authenticated background worker and touches no Blobs itself', async () => {
  reset();
  const response = await cronHandler({ headers: {}, body: '{"next_run":"x"}' });
  assert.equal(response.statusCode, 200);
  const call = outbound.find((o) => o.url === 'https://khantrust.test/.netlify/functions/khan-holders-sync-background');
  assert.ok(call, 'background worker was triggered');
  assert.equal(JSON.parse(call.init.body).trigger, 'scheduled');
  assert.match(call.init.headers.Authorization, /^Bearer \d+\.[0-9a-f]+$/);
  assert.equal(stores.size, 0, 'the scheduled invocation never opened a store');
});

test('background worker rejects an unauthenticated call and syncs to head with a valid token', async () => {
  reset();
  trade(W.a, 'buy', 1000, 0.5, '2026-09-19T15:21:44Z');
  trade(W.b, 'buy', 2000, 1, '2026-09-23T12:58:50Z');
  const denied = await backgroundHandler({ httpMethod: 'POST', headers: {}, body: '{}' });
  assert.equal(denied.statusCode, 401);
  assert.equal((await ledger()).tx.length, 0);

  const ok = await backgroundHandler({ httpMethod: 'POST', headers: { authorization: `Bearer ${issueToken()}` }, body: '{"trigger":"scheduled"}' });
  assert.equal(ok.statusCode, 200);
  const body = JSON.parse(ok.body);
  assert.equal(body.reachedHead, true);
  assert.equal(body.newTransactions, 2);
  const { tx, meta } = await ledger();
  assert.equal(tx.length, 2);
  assert.equal(meta.lastRun.trigger, 'scheduled');
  assert.equal(meta.lastRun.ok, true);
  assert.equal(meta.syncLease, null, 'lease released');
});

// ── 5/6/7. checkpoint, backfill, dedup ──────────────────────────────────────

test('continues from the stored checkpoint and processes only what is newer', async () => {
  reset();
  trade(W.a, 'buy', 1000, 0.5, '2026-06-29T17:15:30Z');
  trade(W.a, 'buy', 500, 0.2, '2026-07-02T16:39:16Z');
  await syncToHead();
  const before = await ledger();
  assert.equal(before.tx.length, 2);
  const cursor = before.meta.lastSignature;

  const s1 = trade(W.b, 'buy', 3000, 1, '2026-09-19T15:21:44Z');
  trade(W.c, 'buy', 10, 0.01, '2026-09-22T15:04:32Z', { failed: true });
  const s3 = trade(W.b, 'sell', 1000, 0.4, '2026-09-26T13:00:01Z');
  const result = await syncToHead();
  const after = await ledger();
  assert.equal(result.reachedHead, true);
  assert.equal(after.tx.length, 4, 'two new balance changes; the failed tx moved nothing');
  assert.deepEqual(after.tx.slice(2).map((t) => t.signature), [s1, s3], 'oldest-first after the checkpoint');
  assert.notEqual(after.meta.lastSignature, cursor);
  assert.deepEqual(after.tx.slice(0, 2), before.tx, 'history untouched');
});

test('a gap larger than one batch is backfilled completely, in order, across batches', async () => {
  reset();
  const start = at('2026-07-03T00:00:00Z');
  const sigs = [];
  for (let i = 0; i < 250; i += 1) sigs.push(trade(i % 2 ? W.a : W.b, 'buy', 10, 0.01, new Date(start + i * 3600_000).toISOString()));
  const first = await runSyncBatch({ trigger: 'test' });
  assert.equal(first.reachedHead, false, 'a 250-signature gap does not fit in one 200-signature batch');
  assert.equal(first.processed, 200);
  await syncToHead();
  const { tx, holders } = await ledger();
  assert.equal(tx.length, 250);
  assert.deepEqual(tx.map((t) => t.signature), sigs);
  assert.equal(holders[W.a].buyCount + holders[W.b].buyCount, 250);
});

test('a signature already in the ledger is never applied twice (lost cursor write)', async () => {
  reset();
  trade(W.a, 'buy', 1000, 0.5, '2026-09-19T15:21:44Z');
  trade(W.a, 'buy', 500, 0.2, '2026-09-23T12:58:50Z');
  await syncToHead();
  const { meta } = await ledger();
  // Simulate the cursor write being lost: rewind it to before both.
  meta.lastSignature = null;
  await holderStore().setJSON('meta.json', meta);
  const result = await syncToHead();
  const { tx, holders } = await ledger();
  assert.equal(result.duplicatesSkipped, 2);
  assert.equal(tx.length, 2);
  assert.equal(holders[W.a].buyCount, 2);
  assert.equal(holders[W.a].totalBought, 1500);
});

test('an overlapping run is turned away by the sync lease', async () => {
  reset();
  trade(W.a, 'buy', 1000, 0.5, '2026-09-19T15:21:44Z');
  await holderStore().setJSON('meta.json', { syncLease: { holder: 'scheduled-other', until: Date.now() + 60_000 } });
  const result = await runSyncBatch({ trigger: 'manual', runId: 'manual-1' });
  assert.equal(result.skipped, 'locked');
  assert.equal((await ledger()).tx.length, 0);
});

// ── 8/9/10. event timestamps ────────────────────────────────────────────────

test('buy and sell rows and holder fields carry the chain block time, never the sync time', async () => {
  reset();
  trade(W.a, 'buy', 1000, 0.5, '2026-09-19T15:21:44Z');
  trade(W.a, 'sell', 400, 0.3, '2026-09-23T12:58:50Z');
  trade(W.a, 'buy', 100, 0.1, '2026-09-26T13:28:17Z');
  await syncToHead();
  const { tx, holders } = await ledger();
  assert.deepEqual(tx.map((t) => [t.direction, t.blockTime]), [
    ['buy', at('2026-09-19T15:21:44Z')], ['sell', at('2026-09-23T12:58:50Z')], ['buy', at('2026-09-26T13:28:17Z')],
  ]);
  const h = holders[W.a];
  assert.equal(h.firstSeenAt, at('2026-09-19T15:21:44Z'));
  assert.equal(h.firstHolderAt, at('2026-09-19T15:21:44Z'));
  assert.equal(h.firstBuyAt, at('2026-09-19T15:21:44Z'));
  assert.equal(h.lastSellAt, at('2026-09-23T12:58:50Z'));
  assert.equal(h.lastBuyAt, at('2026-09-26T13:28:17Z'));
  assert.equal(h.lastActivityAt, at('2026-09-26T13:28:17Z'));
});

test('a holder-count notification is stamped with the buy that raised the count', async () => {
  reset();
  trade(W.a, 'buy', 1000, 0.5, '2026-07-01T23:49:37Z');
  await syncToHead();
  const buyB = trade(W.b, 'buy', 2000, 1, '2026-09-26T13:16:15Z');
  await syncToHead();
  const { alerts } = await ledger();
  const countAlert = alerts.find((a) => a.type === 'holder_count_increased');
  assert.ok(countAlert);
  assert.equal(countAlert.eventAt, at('2026-09-26T13:16:15Z'));
  assert.equal(countAlert.createdAt, at('2026-09-26T13:16:15Z'));
  assert.equal(countAlert.signature, buyB);
  assert.equal(countAlert.timeBasis, 'event');
  assert.ok(countAlert.detectedAt >= countAlert.eventAt);
  const newHolder = alerts.find((a) => a.type === 'new_holder' && a.wallet === W.b);
  assert.equal(newHolder.eventAt, at('2026-09-26T13:16:15Z'));
});

test('legacy holder-count alerts stamped with a sync time get the causing event time at read', () => {
  const transactions = [
    { signature: 's1', wallet: W.a, direction: 'buy', khanAmount: 10, blockTime: at('2026-06-29T17:15:30Z') },
    { signature: 's2', wallet: W.b, direction: 'buy', khanAmount: 10, blockTime: at('2026-07-01T23:49:37Z') },
    { signature: 's3', wallet: W.b, direction: 'sell', khanAmount: 5, blockTime: at('2026-07-02T00:08:11Z') },
  ];
  const legacy = [
    { id: 'holder-count-1', type: 'holder_count_increased', wallet: null, amount: 5, signature: null, createdAt: at('2026-07-02T04:40:01.956Z') },
    { id: 'x-new-holder', type: 'new_holder', wallet: W.b, signature: 's2', createdAt: at('2026-07-01T23:49:37Z') },
    { id: 'holder-count-2', type: 'holder_count_increased', wallet: null, amount: 1, signature: null, createdAt: at('2026-06-01T00:00:00Z') },
  ];
  const [count, newHolder, orphan] = withEventTimes(legacy, transactions);
  assert.equal(count.eventAt, at('2026-07-01T23:49:37Z'), 'the 23:49 buy, not the 04:40 sync');
  assert.equal(count.detectedAt, at('2026-07-02T04:40:01.956Z'));
  assert.equal(count.causeSignature, 's2');
  assert.equal(newHolder.eventAt, at('2026-07-01T23:49:37Z'));
  assert.equal(orphan.eventAt, null, 'no causing event is invented');
  assert.equal(orphan.timeBasis, 'detected');
  assert.equal(legacy[0].eventAt, undefined, 'stored alerts are not mutated');
});

// ── 11/12. Asia/Baku ────────────────────────────────────────────────────────

test('Asia/Baku day boundaries and formatting', () => {
  assert.equal(bakuDayKey(at('2026-09-25T19:59:59Z')), '2026-09-25');
  assert.equal(bakuDayKey(at('2026-09-25T20:00:00Z')), '2026-09-26', '00:00 Baku is 20:00 UTC the day before');
  assert.equal(startOfBakuDay(at('2026-09-26T15:02:00Z')), at('2026-09-25T20:00:00Z'));
  assert.equal(startOfBakuDay(at('2026-09-25T20:00:00Z')), at('2026-09-25T20:00:00Z'));
  assert.equal(formatBakuDateTime(at('2026-09-26T15:02:00Z')), '26.09.2026, 19:02:00');
  assert.equal(formatBakuDateTime(null), '');
});

test('"Bu Günkü" counts the Baku calendar day, not the UTC day', () => {
  const now = at('2026-09-26T15:30:00Z'); // 19:30 Baku
  const transactions = [
    { signature: 'y', wallet: W.c, direction: 'buy', khanAmount: 5, solAmount: 0.1, blockTime: at('2026-09-25T19:30:00Z') }, // 23:30 Baku on the 25th
    { signature: 't1', wallet: W.a, direction: 'buy', khanAmount: 10, solAmount: 0.2, blockTime: at('2026-09-25T20:30:00Z') }, // 00:30 Baku on the 26th
    { signature: 't2', wallet: W.b, direction: 'buy', khanAmount: 10, solAmount: 0.3, blockTime: at('2026-09-26T13:00:01Z') },
  ];
  const holders = {
    [W.a]: { wallet: W.a, isCurrentHolder: true, currentBalance: 10 },
    [W.b]: { wallet: W.b, isCurrentHolder: true, currentBalance: 10 },
    [W.c]: { wallet: W.c, isCurrentHolder: true, currentBalance: 5 },
  };
  const stats = computeHolderStats(holders, transactions, { now });
  assert.equal(stats.todaysBuyers, 2);
  assert.equal(stats.todaysHolders, 2);
  assert.equal(stats.largestBuyTodaySol, 0.3);
  assert.equal(withinRange(at('2026-09-25T20:30:00Z'), 'today', now), true);
  assert.equal(withinRange(at('2026-09-25T19:30:00Z'), 'today', now), false);

  const quiet = computeHolderStats(holders, transactions, { now: at('2026-09-28T10:00:00Z') });
  assert.equal(quiet.todaysBuyers, 0, 'a day with no activity reads zero');
  assert.equal(quiet.todaysHolders, 0);
});

test('the dashboard numbers agree with each other and with the ledger', async () => {
  reset();
  trade(W.a, 'buy', 1000, 0.5, '2026-09-19T15:21:44Z');
  trade(W.b, 'buy', 2000, 1.0, '2026-09-23T12:58:50Z');
  trade(W.b, 'sell', 2000, 0.8, '2026-09-26T13:00:01Z');
  trade(W.c, 'buy', 300, 0.25, '2026-09-26T13:28:17Z');
  await syncToHead();
  const { holders, tx } = await ledger();
  const s = computeHolderStats(holders, tx, { now: at('2026-09-26T15:30:00Z') });
  assert.equal(s.currentHolders, 2, 'B sold out');
  assert.equal(s.uniqueBuyers, 3);
  assert.equal(s.uniqueSellers, 1);
  assert.equal(s.totalBuyVolumeSol.toFixed(9), (0.5 + 1 + 0.25).toFixed(9));
  assert.equal(s.totalSellVolumeSol.toFixed(9), '0.800000000');
  assert.equal(s.netBuyVolumeSol.toFixed(9), (0.5 + 1 + 0.25 - 0.8).toFixed(9));
  assert.equal(s.todaysBuyers, 1);
  assert.equal(s.todaysHolders, 1);
  assert.equal(s.latestEventAt, at('2026-09-26T13:28:17Z'));
});

// ── 13. chart ───────────────────────────────────────────────────────────────

test('growth and volume charts step on the real Baku days after a backfill', async () => {
  reset();
  trade(W.a, 'buy', 1000, 0.5, '2026-07-02T16:39:16Z');
  trade(W.b, 'buy', 2000, 1.0, '2026-09-19T15:21:44Z');
  trade(W.c, 'buy', 300, 0.25, '2026-09-25T21:00:00Z'); // 01:00 Baku on the 26th
  await syncToHead();
  const { tx } = await ledger();
  const now = at('2026-09-26T15:30:00Z');
  const growth = buildGrowthSeries(tx, { days: 30, now });
  assert.equal(growth.length, 30);
  assert.equal(growth.at(-1).date, '2026-09-26');
  const day = (d) => growth.find((g) => g.date === d);
  assert.deepEqual([day('2026-09-18').holderCount, day('2026-09-19').holderCount, day('2026-09-25').holderCount, day('2026-09-26').holderCount], [1, 2, 2, 3]);
  const volume = buildDailySeries(tx, { days: 30, now });
  assert.equal(volume.find((v) => v.date === '2026-09-26').buyVolumeSol, 0.25);
  assert.equal(volume.find((v) => v.date === '2026-09-25').buyVolumeSol, 0);
});

// ── 14/15/16/17. market data ────────────────────────────────────────────────

test('SOL/USD falls through a throttled CoinGecko to the next live provider', async () => {
  reset();
  chain.fail.add('coingecko');
  const quote = await getSolUsdQuote({ fresh: true });
  assert.equal(quote.price, 120.98);
  assert.equal(quote.source, 'coinbase');
  chain.fail.add('coinbase');
  assert.equal((await getSolUsdQuote({ fresh: true })).source, 'kraken');
});

test('unavailable providers yield null, never zero, and KHAN falls back to its pair quote', async () => {
  reset();
  chain.fail.add('coingecko'); chain.fail.add('coinbase'); chain.fail.add('kraken');
  const sol = await getSolUsdQuote({ fresh: true });
  assert.equal(sol.price, null);
  const market = await getKhanMarket(KHAN_MINT, { fresh: true });
  assert.equal(market.solUsd, null);
  assert.equal(market.priceUsd, 0.000003544);
  assert.equal(market.priceSource, 'dexscreener');
  chain.fail.add('dex');
  const none = await getKhanMarket(KHAN_MINT, { fresh: true });
  assert.equal(none.priceUsd, null);
});

test('KHAN on the bonding curve: price from curve reserves, real progress, never "$0"', async () => {
  reset();
  const market = await getKhanMarket(KHAN_MINT, { fresh: true });
  assert.equal(market.venue, 'pumpfun_bonding_curve');
  assert.equal(market.bondingCurve.status, 'active');
  assert.equal(market.bondingCurve.progressPercent, 3.317);
  assert.ok(Math.abs(market.priceSol - 2.938210991e-8) < 1e-15);
  assert.ok(Math.abs(market.priceUsd - 2.938210991e-8 * 120.95) < 1e-13);
  assert.equal(formatUsdAmount(market.priceUsd), '$0.000003554');

  const res = await statsHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${issueToken()}` } });
  const body = JSON.parse(res.body);
  assert.equal(body.stats.solUsdPrice, 120.95, 'the stats endpoint now returns SOL/USD - it never did');
  assert.equal(body.market.bondingCurve.status, 'active');
  assert.equal(body.timeZone, 'Asia/Baku');
});

test('micro-price formatting keeps significant digits', () => {
  assert.equal(formatUsdAmount(0.000003544), '$0.000003544');
  assert.equal(formatUsdAmount(0.00000355512), '$0.000003555');
  assert.equal(formatUsdAmount(0.0042), '$0.0042');
  assert.equal(formatUsdAmount(1234.567), '$1,234.57');
  assert.equal(formatUsdAmount(120.95), '$120.95');
  assert.equal(formatUsdAmount(0), '$0');
  assert.equal(formatUsdAmount(null), null);
  assert.equal(formatUsdAmount(undefined), null);
  assert.equal(formatUsdAmount('abc'), null);
});

test('a completed curve is reported as migrated and priced from the live DEX pool', async () => {
  reset();
  chain.curve = curveAccount({ rt: 0n, vt: 279_900_000_000_000n, complete: 1 });
  chain.pairs = [pumpPair('0.0000001'), { dexId: 'pumpswap', pairAddress: 'PoolPumpSwap', priceUsd: '0.00004120', priceNative: '0.00000034', liquidity: { usd: 90000 } }, { dexId: 'raydium', pairAddress: 'PoolRay', priceUsd: '0.00004000', liquidity: { usd: 1000 } }];
  const market = await getKhanMarket(KHAN_MINT, { fresh: true });
  assert.equal(market.bondingCurve.status, 'complete');
  assert.equal(market.bondingCurve.progressPercent, null, 'no curve percentage once migrated');
  assert.equal(market.venue, 'pumpswap');
  assert.equal(market.pairAddress, 'PoolPumpSwap');
  assert.equal(market.priceUsd, 0.0000412);
});

test('curve status is "unknown" when the account cannot be read, and no percentage is invented', async () => {
  reset();
  chain.fail.add('curve');
  const market = await getKhanMarket(KHAN_MINT, { fresh: true });
  assert.equal(market.bondingCurve.status, 'unknown');
  assert.equal(market.bondingCurve.progressPercent, null);
  assert.equal(market.priceUsd, 0.000003544);

  const nonStandard = decodeBondingCurve(Buffer.from(curveAccount({ vt: 2_000_000_000_000_000n, rt: 1_000_000_000_000_000n }), 'base64'));
  assert.equal(nonStandard.complete, false);
  assert.equal(nonStandard.progressPercent, null, 'reserves off the standard curve: percentage not derivable');
});
