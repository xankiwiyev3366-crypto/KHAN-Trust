// Discovery ENGINE (Phase 2). Pure, source-agnostic glue between the provider
// registry and the cache: it runs the enabled providers, normalizes their raw
// records into the exact early-stage project shape the UI already renders,
// dedupes across manual + previously-discovered + same-run projects, and
// returns the merged discovered set plus run stats.
//
// Discovered projects are ALWAYS teamVerified:false and origin:'discovered'.
// They never enter the manual approval store; they are cached separately and
// merged in at read time.
import { getProviders } from './_discoveryProviders.mjs';
import { VALID_STAGES } from './_earlyStageStore.mjs';

const URL_PATTERN = /^https?:\/\//i;

function clampText(value, max) {
  return String(value || '').replace(/<[^>]*>/g, '').trim().slice(0, max);
}

function clampUrl(value, max = 300) {
  const clean = clampText(value, max);
  return URL_PATTERN.test(clean) ? clean : '';
}

// name -> comparable key: lowercase alphanumerics only ("Nova Markets" ->
// "novamarkets"), so spacing/punctuation/casing differences still dedupe.
export function normName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// website -> bare host ("https://www.foo.io/x" -> "foo.io"), so two records
// pointing at the same site collapse regardless of path/subdomain noise.
export function siteHost(value) {
  try {
    const u = new URL(String(value));
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project';
}

// Short stable hash so re-running discovery yields the SAME id for the same
// project (name+source), which keeps profile links stable and prevents the
// cache from churning ids on every run.
function stableHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// The set of dedupe signatures a project occupies. A candidate collides if it
// shares ANY signature with an already-accepted project. Empty/absent fields
// contribute no signature (so blank symbols never collide with each other).
export function projectSignatures(p) {
  const sigs = [];
  const n = normName(p.name);
  if (n) sigs.push(`name:${n}`);
  const sym = String(p.symbol || '').trim().toUpperCase();
  if (sym) sigs.push(`sym:${sym}`);
  const host = siteHost(p.website);
  if (host) sigs.push(`site:${host}`);
  const ca = String(p.contractAddress || '').trim().toLowerCase();
  if (ca) sigs.push(`ca:${ca}`);
  return sigs;
}

// Build a Set of every signature used by an existing collection.
export function buildSignatureSet(projects) {
  const set = new Set();
  for (const p of projects || []) {
    for (const s of projectSignatures(p)) set.add(s);
  }
  return set;
}

// Normalize a loose provider record into the stored/public discovered-project
// shape. Mirrors the manual project fields the card/profile consume, and adds
// origin/source/discoveredAt/github/contractAddress.
export function normalizeDiscovered(raw, provider, now = new Date().toISOString()) {
  const name = clampText(raw.name, 120);
  if (!name) return null;
  const stage = VALID_STAGES.includes(raw.stage) ? raw.stage : 'idea';
  const source = provider?.label || 'Discovery';
  const id = `esd-${slugify(name)}-${stableHash(`${normName(name)}|${provider?.id || ''}`)}`;
  return {
    id,
    origin: 'discovered',
    // Which provider produced this record. Kept internal (not surfaced by the
    // public list/get) and used by reconciliation to prune orphaned records
    // when a provider stops running (e.g. mock -> real switch).
    providerId: provider?.id || '',
    source,
    sourceUrl: clampUrl(raw.sourceUrl || raw.website || raw.github),
    discoveredAt: now,
    name,
    symbol: clampText(raw.symbol, 20).toUpperCase(),
    logoUrl: clampUrl(raw.logoUrl),
    description: clampText(raw.description, 400),
    stage,
    launchStatus: clampText(raw.launchStatus, 80),
    estimatedLaunch: clampText(raw.estimatedLaunch, 40),
    chain: clampText(raw.chain, 60),
    category: clampText(raw.category, 60),
    website: clampUrl(raw.website),
    twitter: clampUrl(raw.twitter),
    telegram: clampUrl(raw.telegram),
    discord: clampUrl(raw.discord),
    github: clampUrl(raw.github),
    contractAddress: clampText(raw.contractAddress, 120),
    communitySize: Math.max(0, Number(raw.communitySize) || 0),
    // Discovered projects are NEVER auto-verified (requirement #5).
    teamVerified: false,
    buildingProgress: 0,
    builtWithLaunchpad: false,
    launchpadUrl: '',
    featured: false,
    // Empty profile sections so the profile page renders cleanly.
    overview: '',
    roadmap: [],
    team: [],
    progressTimeline: [],
    milestones: [],
    whyEarlyStage: '',
    riskNotes: '',
    createdAt: now,
    updatedAt: now,
  };
}

// Run every enabled provider, collect + normalize + dedupe, and RECONCILE the
// cache so it only ever reflects the current providers.
//
// Reconciliation rules (this is what prunes stale/orphaned records):
//   - manual projects seed the dedupe set, so a discovered dup of a real
//     submission is always dropped in favor of the human-curated one.
//   - a provider that produces results this run REPLACES its own cached set
//     (fresh data wins; its old records are dropped).
//   - a provider that is registered/running but returned nothing this run
//     (transient error/empty) keeps its previously cached records, so a blip
//     doesn't wipe a source.
//   - everything else is an orphan and is DROPPED: records from a provider no
//     longer running (e.g. mock entries after the real flag is switched on),
//     and legacy records with no providerId.
// discoveredAt is preserved for a record whose id already existed, so the
// "discovered on" date stays the first-seen date across runs.
export async function runDiscovery({ manualProjects = [], existingDiscovered = [], limitPerProvider = 20 } = {}) {
  const now = new Date().toISOString();
  const providers = getProviders();
  const runningIds = new Set(providers.map((p) => p.id));
  const prevById = new Map((existingDiscovered || []).map((p) => [p.id, p]));

  // Seed with manual signatures first (manual wins on any collision).
  const seen = buildSignatureSet(manualProjects);

  const kept = [];
  const producedByProvider = new Set();
  const providerStats = [];

  for (const provider of providers) {
    let added = 0;
    let fetched = 0;
    try {
      const raw = await provider.fetch({ limit: limitPerProvider });
      const list = Array.isArray(raw) ? raw : [];
      fetched = list.length;
      for (const item of list) {
        const project = normalizeDiscovered(item, provider, now);
        if (!project) continue;
        const sigs = projectSignatures(project);
        if (sigs.some((s) => seen.has(s))) continue; // dup vs manual or an earlier-accepted project
        for (const s of sigs) seen.add(s);
        // Keep the original first-seen dates if we've cached this id before.
        const prev = prevById.get(project.id);
        if (prev) {
          project.discoveredAt = prev.discoveredAt || project.discoveredAt;
          project.createdAt = prev.createdAt || project.createdAt;
        }
        kept.push(project);
        added += 1;
      }
      if (added > 0) producedByProvider.add(provider.id);
    } catch (error) {
      providerStats.push({ id: provider.id, label: provider.label, real: Boolean(provider.real), fetched, added, error: error.message });
      continue;
    }
    providerStats.push({ id: provider.id, label: provider.label, real: Boolean(provider.real), fetched, added });
  }

  // Reconcile: preserve cached records ONLY for a running provider that did not
  // produce anything this run (transient protection). All other prior records -
  // replaced providers, orphaned providers, and legacy (no providerId) entries -
  // are intentionally left out, which removes stale/mock data from the cache.
  let prunedOrphans = 0;
  let preservedOnError = 0;
  for (const p of existingDiscovered || []) {
    const pid = p.providerId;
    const keepOnTransient = pid && runningIds.has(pid) && !producedByProvider.has(pid);
    if (!keepOnTransient) {
      prunedOrphans += 1;
      continue;
    }
    const sigs = projectSignatures(p);
    if (sigs.some((s) => seen.has(s))) { prunedOrphans += 1; continue; }
    for (const s of sigs) seen.add(s);
    kept.push(p);
    preservedOnError += 1;
  }

  const projects = kept.sort((a, b) => new Date(b.discoveredAt) - new Date(a.discoveredAt));
  return {
    projects,
    stats: {
      lastRunAt: now,
      providerCount: providers.length,
      discoveredCount: projects.length,
      prunedOrphans,
      preservedOnError,
      providers: providerStats,
    },
  };
}
