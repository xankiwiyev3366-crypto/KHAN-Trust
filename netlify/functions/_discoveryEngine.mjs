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

// Run every enabled provider, collect + normalize + dedupe.
// `manualProjects` and `existingDiscovered` seed the signature set so we never
// duplicate something already shown (manual takes precedence) or already
// cached. Providers that throw are skipped, not fatal.
export async function runDiscovery({ manualProjects = [], existingDiscovered = [], limitPerProvider = 20 } = {}) {
  const now = new Date().toISOString();
  const providers = getProviders();

  // Seed with manual signatures first so a discovered project that duplicates
  // a real submission is dropped in favor of the human-curated one.
  const seen = buildSignatureSet(manualProjects);

  // Preserve previously discovered projects (keep their original discoveredAt),
  // and register their signatures so this run won't re-add them.
  const byId = new Map();
  for (const p of existingDiscovered) {
    if (!seen.has(`__id:${p.id}`)) {
      byId.set(p.id, p);
      for (const s of projectSignatures(p)) seen.add(s);
    }
  }

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
        // Skip if it collides with anything already accepted, unless the only
        // reason it "exists" is that we already cached this exact project id
        // (in which case refresh its mutable fields but keep discoveredAt).
        if (byId.has(project.id)) {
          const prev = byId.get(project.id);
          byId.set(project.id, { ...project, discoveredAt: prev.discoveredAt, createdAt: prev.createdAt });
          continue;
        }
        if (sigs.some((s) => seen.has(s))) continue;
        for (const s of sigs) seen.add(s);
        byId.set(project.id, project);
        added += 1;
      }
    } catch (error) {
      providerStats.push({ id: provider.id, label: provider.label, error: error.message, fetched, added });
      continue;
    }
    providerStats.push({ id: provider.id, label: provider.label, real: Boolean(provider.real), fetched, added });
  }

  const projects = [...byId.values()].sort((a, b) => new Date(b.discoveredAt) - new Date(a.discoveredAt));
  return {
    projects,
    stats: {
      lastRunAt: now,
      providerCount: providers.length,
      discoveredCount: projects.length,
      providers: providerStats,
    },
  };
}
