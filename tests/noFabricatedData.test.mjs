// THE REGRESSION TEST FOR THE WORST BUG THIS CODEBASE HAS SHIPPED.
//
// netlify/functions/_discoveryProviders.mjs used to carry ~18 invented crypto
// projects — fabricated names, tickers, descriptions, websites, X handles,
// community sizes and contract addresses — and served them BY DEFAULT through
// the scheduled discovery worker into the public Early Stage list, attributed
// to DexScreener and CoinGecko. Six client modules separately fell back to
// localStorage fixtures on any network error, in production, and reported
// success for submissions no server ever received.
//
// Deleting that code fixes it once. These tests are what stop it coming back:
// they fail if a stand-in registry reappears, if a known fabricated identifier
// is reintroduced anywhere, if the discovery engine stops purging unstamped
// cache records, or if a dev-only fallback survives into the production bundle.
//
// Note the deliberate asymmetry with the rest of the suite: most tests here
// assert that a feature works. These assert that a feature CANNOT work, which
// is the only kind of guarantee worth having about fabricated data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { getProviders } from '../netlify/functions/_discoveryProviders.mjs';
import { runDiscovery, normalizeDiscovered } from '../netlify/functions/_discoveryEngine.mjs';
import { renderBadgeSvg } from '../netlify/functions/verify-badge.mjs';
import { CURATED_PROJECTS } from '../netlify/functions/_curatedProjects.mjs';

const ROOT = process.cwd();

// Names, tickers, domains and addresses that only ever existed in the deleted
// mock registry. None of them is a real project, so a match anywhere in the
// shipped source is proof the fabrications came back.
const FABRICATED_IDENTIFIERS = [
  'Lumen Protocol', 'Zephyr Finance', 'Aurora Pulse', 'Nimbus Cash',
  'Solstice SDK', 'Helios Bridge', 'Nova Markets', 'Aether Vaults',
  'Coral Social', 'Pangolin Pay', 'Orbit Options', 'Beacon ID',
  'Frostbyte Games', 'Verdant RWA', 'Ignition Pad', 'Cascade Rollup',
  'Halo Wallet', 'QuickProof',
  'lumenprotocol.io', 'zephyr.fi', 'aurorapulse.xyz', 'nimbus.cash',
  'novamarkets.xyz', 'aethervaults.xyz', 'coral.social', 'pangolinpay.io',
  'orbitoptions.xyz', 'beaconid.xyz', 'frostbyte.gg', 'verdant.finance',
  'ignitionpad.xyz', 'cascade.build', 'halowallet.app', 'quickproof.xyz',
  '0xLUMEN', 'AURP1111', '0xNIMBUS',
];

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(js|jsx|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// ── The provider registry ────────────────────────────────────────────────────

test('every discovery provider is real — there is no mock registry to fall back to', () => {
  const providers = getProviders();
  assert.ok(providers.length > 0, 'discovery must have at least one real provider');
  for (const provider of providers) {
    assert.equal(provider.real, true, `provider "${provider.id}" is not marked real`);
  }
});

test('the provider set does not change when the deleted mock flag is set either way', () => {
  // The flag is gone. If someone reintroduces it, the two id sets diverge and
  // this fails — which is the point: no environment variable may ever again
  // decide whether the platform tells the truth.
  const before = getProviders().map((p) => p.id).sort();
  const original = process.env.EARLY_STAGE_DISCOVERY_REAL;
  try {
    process.env.EARLY_STAGE_DISCOVERY_REAL = '0';
    assert.deepEqual(getProviders().map((p) => p.id).sort(), before);
    process.env.EARLY_STAGE_DISCOVERY_REAL = '1';
    assert.deepEqual(getProviders().map((p) => p.id).sort(), before);
  } finally {
    if (original === undefined) delete process.env.EARLY_STAGE_DISCOVERY_REAL;
    else process.env.EARLY_STAGE_DISCOVERY_REAL = original;
  }
});

// ── The engine's behaviour when sources fail ────────────────────────────────

test('every real provider yields nothing when its source is unreachable', async () => {
  // THE INVARIANT, tested against the actual providers rather than a stand-in:
  // network dead => []. Not a cached record, not a sample, not a "representative"
  // project. The run simply discovers less.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    for (const provider of getProviders()) {
      const result = await provider.fetch({ limit: 5 });
      assert.deepEqual(result, [], `provider "${provider.id}" invented data during an outage`);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a run in which no provider returns anything discovers nothing', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    const { projects } = await runDiscovery({ manualProjects: [], existingDiscovered: [] });
    assert.deepEqual(projects, [], 'an outage must discover nothing, not something');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('unstamped cached records are purged even while their provider still runs', async () => {
  // THE EXACT PRODUCTION HAZARD. The deleted mock providers reused the real
  // ids, so a fabricated record cached under providerId 'dexscreener' would be
  // preserved by the transient-protection rule ("a running provider that
  // returned nothing keeps its cached records") and served indefinitely.
  // The `real` provenance stamp is what makes it droppable.
  const fabricated = {
    id: 'esd-aurora-pulse-abc', providerId: 'dexscreener', name: 'Aurora Pulse',
    symbol: 'AURP', contractAddress: 'AURP1111111111111111111111111111111111pump',
    discoveredAt: '2026-01-01T00:00:00.000Z',
    // No `real` field — exactly how the mock providers wrote it.
  };
  // Offline: 'dexscreener' IS a running provider that returned nothing this
  // run, which is exactly the transient-protection case that used to rescue
  // fabricated records. Stubbing fetch also keeps the suite hermetic.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  let projects; let stats;
  try {
    ({ projects, stats } = await runDiscovery({
      manualProjects: [],
      existingDiscovered: [fabricated],
    }));
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(projects.find((p) => p.name === 'Aurora Pulse'), undefined,
    'a fabricated cached record survived reconciliation');
  assert.ok(stats.prunedUnstamped >= 1, 'the purge counter must record the drop');
});

test('normalizeDiscovered stamps provenance from the provider, never optimistically', () => {
  const real = normalizeDiscovered({ name: 'Some Token' }, { id: 'dexscreener', label: 'DexScreener', real: true });
  assert.equal(real.real, true);
  // A provider that does not assert `real: true` produces unstamped records,
  // which reconciliation then drops. Fabrication cannot persist by omission.
  const unmarked = normalizeDiscovered({ name: 'Some Token' }, { id: 'x', label: 'X' });
  assert.equal(unmarked.real, false);
});

// ── Source-level guarantees ─────────────────────────────────────────────────

test('no fabricated project identifier appears anywhere in the shipped source', () => {
  const files = [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'netlify'))];
  const offences = [];
  for (const file of files) {
    const contents = readFileSync(file, 'utf8');
    for (const needle of FABRICATED_IDENTIFIERS) {
      if (contents.includes(needle)) offences.push(`${file}: ${needle}`);
    }
  }
  assert.deepEqual(offences, [], `fabricated data reintroduced:\n${offences.join('\n')}`);
});

test('the dev-only fallback predicate is the single gate, and it checks DEV', () => {
  const source = readFileSync(join(ROOT, 'src', 'devFallback.js'), 'utf8');
  assert.match(source, /import\.meta\.env\?\.DEV/,
    'the fallback gate must test import.meta.env.DEV so Vite can eliminate the branch');

  // No client module may keep a private, ungated copy of the old predicate.
  const rogue = sourceFiles(join(ROOT, 'src'))
    .filter((f) => !f.endsWith('devFallback.js'))
    .filter((f) => /function isFunctionUnavailable\s*\(/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(rogue, [], `these modules still define their own ungated fallback gate:\n${rogue.join('\n')}`);
});

// ── Claims the platform cannot substantiate ─────────────────────────────────
//
// A sibling family to the fabricated records above. Nothing here is invented
// DATA; each one is an assertion of STATUS that no evidence backs — which on a
// trust product is the same defect wearing a different hat.

test('the embeddable badge never claims a rating for a project nothing rated', () => {
  // /badge/:projectId accepts an arbitrary string. It used to answer any of
  // them with a gold "Rated" badge, embeddable on any website. The only claim
  // this endpoint can substantiate is the one it actually looks up.
  const unknown = renderBadgeSvg('unverified');
  assert.ok(!unknown.includes('Rated'), 'the badge still claims an unbacked rating');
  assert.ok(unknown.includes('Unverified'), 'the non-verified badge must say so plainly');

  // PHASE 3 NARROWED THIS DELIBERATELY, so the change is recorded rather than
  // quietly absorbed. This used to assert that EVERY non-verified status
  // rendered one identical badge, including 'pending'. The badge now has five
  // states, because flattening them was true but useless: an owner mid-review
  // and an owner whose year lapsed both saw "Unverified" with no hint which
  // one they were, and the expired one had no way to learn they needed to
  // renew. Renderer input is now a resolved STATE (see _badgeState.mjs), not a
  // raw store status.
  //
  // What has NOT changed, and is what this test was actually protecting:
  //   - no "Rated", ever;
  //   - a REJECTED review is not published on the applicant's own website;
  //   - anything unrecognised falls back to the weakest claim.
  for (const state of ['unverified', 'rejected', '', 'not-a-status', undefined, null]) {
    assert.equal(renderBadgeSvg(state), unknown, `state "${state}" produced a distinguishable badge`);
  }

  // The one provable claim still renders, so live embeds are unaffected.
  const verified = renderBadgeSvg('verified');
  assert.ok(verified.includes('Verified'), 'the verified badge regressed');
  assert.notEqual(verified, unknown);

  // And the three states that ARE now distinguishable must never read as the
  // provable one. tests/badgeWidget.test.mjs covers each in full.
  for (const state of ['pending', 'expired', 'revoked']) {
    const svg = renderBadgeSvg(state);
    assert.ok(!svg.includes('Rated'), `state "${state}" reintroduced a Rated claim`);
    assert.ok(!/>Verified/.test(svg), `state "${state}" rendered as verified`);
  }
});

test('KHAN Trust does not grant itself the verification it sells', () => {
  // The curated record is first-party placement in a first-party directory,
  // which is fine and is labelled `featured`. Asserting `teamVerified` is not:
  // that badge is earned by signing with the controlling wallet and passing
  // admin review, and KHAN went through neither.
  for (const project of CURATED_PROJECTS) {
    assert.equal(project.teamVerified, false,
      `curated project "${project.name}" self-granted the verified-team badge`);
    assert.ok(String(project.riskNotes || '').trim().length > 0,
      `curated project "${project.name}" must disclose that it is a first-party listing`);
  }

  // The client mirror must not disagree with the server, or the dev fallback
  // becomes a fixture that contradicts production.
  const mirror = readFileSync(join(ROOT, 'src', 'earlyStage.js'), 'utf8');
  assert.ok(!/teamVerified:\s*true/.test(mirror),
    'the client curated mirror still self-grants a verified team');
});

test('no product surface still sells the token as gating the platform', async () => {
  // "$KHAN ... powering future holder utility" appeared in the curated record,
  // the ecosystem strip and the roadmap panel. Holding the token has never
  // unlocked anything, so every one of those was a claim about a product that
  // does not exist.
  //
  // Asserted against the VALUES the app renders, not the raw file text: the
  // source legitimately quotes the removed phrasing in the comments explaining
  // why it went, and a test that cannot tell a claim from its own retraction
  // makes the reasoning undeletable.
  const claim = /holder utility|holder benefit|token-gated access is active/i;
  const offences = [];

  const walk = (node, path) => {
    if (typeof node === 'string') {
      if (claim.test(node)) offences.push(`${path}: ${node.slice(0, 80)}`);
    } else if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
    } else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    }
  };

  walk(CURATED_PROJECTS, 'curated(server)');
  for (const locale of ['en', 'az', 'ru', 'tr']) {
    const dict = (await import(`../src/i18n/${locale}.js`)).default;
    walk(dict, `i18n(${locale})`);
  }

  assert.deepEqual(offences, [], `token-utility claims reintroduced:\n${offences.join('\n')}`);
});

test('the payment verifier reads the server-side RPC variable, not the retired public one', () => {
  // verify-solana-payment.mjs read ONLY `VITE_SOLANA_RPC_URL` — a variable the
  // deploy docs instruct the operator to DELETE, because Vite inlined the
  // provider key into every visitor's bundle. Following that instruction
  // silently moved live payment verification onto the throttled public
  // endpoint, where a rate-limited getTransaction is indistinguishable from a
  // transaction that never happened.
  const source = readFileSync(join(ROOT, 'netlify', 'functions', 'verify-solana-payment.mjs'), 'utf8');
  const assignment = source.match(/const RPC_URL = ([^;]+);/);
  assert.ok(assignment, 'RPC_URL assignment not found — did this file get restructured?');

  const expression = assignment[1];
  assert.ok(expression.includes('process.env.SOLANA_RPC_URL'),
    'the payment path must read the server-side SOLANA_RPC_URL');
  // Order matters: the retired name may only ever be a fallback.
  const serverAt = expression.indexOf('process.env.SOLANA_RPC_URL');
  const retiredAt = expression.indexOf('process.env.VITE_SOLANA_RPC_URL');
  if (retiredAt !== -1) {
    assert.ok(serverAt < retiredAt,
      'the retired VITE_SOLANA_RPC_URL must not take precedence over SOLANA_RPC_URL');
  }
});

// ── The built artefact ──────────────────────────────────────────────────────
//
// The source checks above can be satisfied while the bundle still ships the
// fixture (a mis-set define, a changed Vite config). Only the artefact settles
// it. Skipped when dist/ is absent so the suite stays runnable without a build;
// `npm run build` produces it and CI/manual verification runs both.

test('the production bundle contains no fabricated data and no dev fallback fixture', (t) => {
  const assets = join(ROOT, 'dist', 'assets');
  if (!existsSync(assets)) {
    t.skip('no dist/ — run `npm run build` first');
    return;
  }
  const bundles = readdirSync(assets).filter((f) => f.endsWith('.js'));
  assert.ok(bundles.length > 0, 'dist/assets contains no JS');

  const offences = [];
  for (const file of bundles) {
    const contents = readFileSync(join(assets, file), 'utf8');
    for (const needle of FABRICATED_IDENTIFIERS) {
      if (contents.includes(needle)) offences.push(`${file}: ${needle}`);
    }
  }
  assert.deepEqual(offences, [], `the production bundle ships fabricated data:\n${offences.join('\n')}`);
});
