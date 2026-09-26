// Which credential a blob read goes out with.
//
// 2026-09 incident: every blob read on the site - holder analytics, early-stage
// list, logins - failed with "Netlify Blobs has generated an internal error (401
// status code)", because production authenticated with a hand-made Personal
// Access Token (NETLIFY_BLOBS_TOKEN) and that token stopped being accepted. The
// fix is that a real invocation uses the credential Netlify attaches to the
// event instead. These tests pin that: with `event.blobs` present the PAT is
// never sent; without it (local scripts) the PAT still works; a warm instance
// never reuses a previous request's token; and a failure is logged with enough
// to diagnose it but never the token.
import test from 'node:test';
import assert from 'node:assert/strict';

const PAT = 'pat-should-not-be-sent-from-an-invocation';
process.env.SITE_ID = 'd471a553-b579-4bee-850a-cab4a70dbff7';
process.env.NETLIFY_BLOBS_TOKEN = PAT;
delete process.env.NETLIFY_BLOBS_CONTEXT;

const { connectBlobs } = await import('../netlify/functions/_blobsConnect.mjs');
const { getNamedStore } = await import('../netlify/functions/_blobsClient.mjs');

const sent = [];
let reply = () => new Response(JSON.stringify({ ok: 1 }), { status: 200 });
globalThis.fetch = async (url, init = {}) => {
  const headers = new Headers(init.headers);
  sent.push({ url: String(url), auth: headers.get('authorization') });
  return reply();
};

function invocation(token) {
  return {
    httpMethod: 'GET',
    headers: { 'x-nf-site-id': process.env.SITE_ID, 'x-nf-deploy-id': 'deploy-1' },
    blobs: Buffer.from(JSON.stringify({ url: 'https://blobs.example.test', token })).toString('base64'),
  };
}

test('without an invocation context (local scripts) the PAT is used', async () => {
  sent.length = 0;
  assert.equal(connectBlobs({ httpMethod: 'GET', headers: {} }), false);
  await getNamedStore('khan-holder-analytics').get('holders.json', { type: 'json' });
  // The PAT path asks the API for a signed URL first, so the PAT rides on that call.
  assert.ok(sent.some((r) => r.auth === `Bearer ${PAT}`));
});

test('an invocation reads with the credential Netlify attached, never the PAT', async () => {
  sent.length = 0;
  assert.equal(connectBlobs(invocation('invocation-token-1')), true);
  await getNamedStore('khan-holder-analytics').get('holders.json', { type: 'json' });
  assert.ok(sent.length > 0);
  for (const request of sent) assert.notEqual(request.auth, `Bearer ${PAT}`);
  assert.ok(sent.some((r) => r.url.startsWith('https://blobs.example.test') && r.auth === 'Bearer invocation-token-1'));
});

test('a warm instance does not reuse the previous request\'s token', async () => {
  connectBlobs(invocation('invocation-token-1'));
  const first = getNamedStore('khan-holder-analytics');
  assert.equal(getNamedStore('khan-holder-analytics'), first, 'same request, same handle');
  connectBlobs(invocation('invocation-token-2'));
  sent.length = 0;
  await getNamedStore('khan-holder-analytics').get('holders.json', { type: 'json' });
  assert.ok(sent.some((r) => r.auth === 'Bearer invocation-token-2'));
  assert.ok(!sent.some((r) => r.auth === 'Bearer invocation-token-1'));
});

test('a malformed event.blobs never throws, it falls through', () => {
  assert.equal(connectBlobs({ headers: {}, blobs: '%%%not-base64-json' }), false);
  assert.equal(connectBlobs(undefined), false);
});

test('a rejected credential is logged with store, op and status - and no token', async () => {
  connectBlobs(invocation('secret-invocation-token'));
  reply = () => new Response('unauthorized', { status: 401 });
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    await assert.rejects(getNamedStore('khan-holder-analytics').get('holders.json', { type: 'json' }), /401/);
  } finally {
    console.error = original;
    reply = () => new Response(JSON.stringify({ ok: 1 }), { status: 200 });
  }
  const line = logged.join('\n');
  assert.match(line, /store="khan-holder-analytics" op=get auth=invocation status=401/);
  assert.ok(!line.includes('secret-invocation-token'));
  assert.ok(!line.includes(PAT));
});
