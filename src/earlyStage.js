// "Early Stage Projects" feature - client module. Mirrors report.js: real
// calls go to netlify/functions/early-stage-*; when those functions are
// unreachable (plain `vite dev`, no Netlify Functions server) calls
// transparently fall back to a localStorage-backed mock with the same shape,
// so the full flow is testable end-to-end in dev.
//
// Fully additive: this module is only imported by the lazy-loaded Early Stage
// UI. It touches no existing store, API, or route.

// Canonical stage list, mirrored server-side in _earlyStageStore.mjs. `id` is
// what gets stored/validated; `label` is the English display fallback (the UI
// prefers i18n keys `earlyStage.stages.<id>` and falls back to these).
export const EARLY_STAGE_STAGES = [
  { id: 'idea', label: 'Idea' },
  { id: 'building', label: 'Building' },
  { id: 'private_testing', label: 'Private Testing' },
  { id: 'public_beta', label: 'Public Beta' },
  { id: 'testnet', label: 'Testnet' },
  { id: 'pre_sale', label: 'Pre-Sale' },
  { id: 'launching_soon', label: 'Launching Soon' },
  { id: 'mainnet_live', label: 'Mainnet Live' },
];

export const EARLY_STAGE_STATUSES = ['pending', 'approved', 'rejected', 'archived'];

export function stageLabel(id) {
  return EARLY_STAGE_STAGES.find((s) => s.id === id)?.label || id || 'Idea';
}

const FALLBACK_KEY = 'khan-trust-early-stage-fallback-v1';

function readFallbackStore() {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    return raw ? JSON.parse(raw) : { projects: [] };
  } catch {
    return { projects: [] };
  }
}

function writeFallbackStore(store) {
  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(store));
  } catch {
    // ignore - dev fallback only
  }
}

function isFunctionUnavailable(error) {
  return Boolean(error) && (error.status === undefined || error.status === 404);
}

async function callFunction(path, options) {
  const response = await fetch(`/.netlify/functions/${path}`, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.message || `Request to ${path} failed (${response.status})`);
    error.status = response.status;
    error.reason = body.reason;
    throw error;
  }
  return response.json();
}

const URL_PATTERN = /^https?:\/\//i;

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project';
}

// Local mirror of the server's project builder so the dev fallback stores the
// exact same shape the functions would.
function buildLocalProject(payload, meta = {}) {
  const now = new Date().toISOString();
  const clampUrl = (v) => (URL_PATTERN.test(String(v || '')) ? String(v).slice(0, 300) : '');
  const entries = (list) =>
    (Array.isArray(list) ? list : [])
      .slice(0, 12)
      .map((item) =>
        typeof item === 'string'
          ? { title: item.slice(0, 500), detail: '' }
          : { title: String(item?.title || '').slice(0, 500), detail: String(item?.detail || '').slice(0, 500), done: Boolean(item?.done) }
      )
      .filter((e) => e.title || e.detail);
  return {
    id: meta.id || `es-${slugify(payload.name)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: String(payload.name || '').slice(0, 120),
    symbol: String(payload.symbol || '').slice(0, 20).toUpperCase(),
    logoUrl: clampUrl(payload.logoUrl),
    description: String(payload.description || '').slice(0, 400),
    stage: EARLY_STAGE_STAGES.some((s) => s.id === payload.stage) ? payload.stage : 'idea',
    launchStatus: String(payload.launchStatus || '').slice(0, 80),
    estimatedLaunch: String(payload.estimatedLaunch || '').slice(0, 40),
    chain: String(payload.chain || '').slice(0, 60),
    category: String(payload.category || '').slice(0, 60),
    website: clampUrl(payload.website),
    twitter: clampUrl(payload.twitter),
    telegram: clampUrl(payload.telegram),
    discord: clampUrl(payload.discord),
    communitySize: Math.max(0, Number(payload.communitySize) || 0),
    teamVerified: Boolean(payload.teamVerified),
    buildingProgress: Math.max(0, Math.min(100, Number(payload.buildingProgress) || 0)),
    builtWithLaunchpad: Boolean(payload.builtWithLaunchpad),
    launchpadUrl: clampUrl(payload.launchpadUrl),
    overview: String(payload.overview || '').slice(0, 4000),
    roadmap: entries(payload.roadmap),
    team: entries(payload.team),
    progressTimeline: entries(payload.progressTimeline),
    milestones: entries(payload.milestones),
    whyEarlyStage: String(payload.whyEarlyStage || '').slice(0, 2000),
    riskNotes: String(payload.riskNotes || '').slice(0, 2000),
    contactName: String(payload.contactName || '').slice(0, 120),
    contactEmail: String(payload.contactEmail || '').slice(0, 300),
    submittedByWallet: String(payload.wallet || '').slice(0, 64),
    // Future-ready schema (reserved) - mirrors the server builder.
    funding: meta.funding ?? null,
    saleType: String(payload.saleType || '').slice(0, 40),
    countdownAt: String(payload.countdownAt || '').slice(0, 40),
    communityVotes: Math.max(0, Number(payload.communityVotes) || 0),
    aiLaunchReadiness: meta.aiLaunchReadiness ?? null,
    investorWatchCount: Math.max(0, Number(meta.investorWatchCount) || 0),
    status: meta.status || 'pending',
    featured: meta.featured ?? false,
    hidden: meta.hidden ?? false,
    adminNotes: meta.adminNotes || '',
    createdAt: meta.createdAt || now,
    updatedAt: now,
  };
}

function isVisible(p) {
  return p.status === 'approved' && !p.hidden;
}

// ---- Auto-discovery (Phase 2) --------------------------------------------
// The real discovery pipeline lives server-side (netlify/functions/
// _discoveryProviders + _discoveryEngine + early-stage-discover-run) and the
// list endpoint returns manual + discovered already merged. This client-side
// mock set is ONLY used by the dev fallback below (plain `vite dev`, no
// Netlify Functions) so the merged experience - cards, badges, filters,
// sorting, search, autocomplete - is fully testable locally without any API.
const DISCOVERY_MOCK_SEED = [
  // `launchedAgoDays` (dev-only) synthesizes a fresh launch date at build time so
  // the "New / Recently launched" badge + filter are demonstrable in plain
  // `vite dev`. Real discovered projects carry a concrete `launchedAt` ISO from
  // the DexScreener provider instead.
  { name: 'Aurora Pulse', symbol: 'AURP', chain: 'Solana', category: 'Newly Launched', stage: 'mainnet_live', launchStatus: 'Recently launched', description: 'Freshly launched Solana token just detected on DexScreener.', website: 'https://aurorapulse.xyz', twitter: 'https://x.com/aurorapulse', source: 'DexScreener', launchedAgoDays: 0 },
  { name: 'Nimbus Cash', symbol: 'NMBS', chain: 'Base', category: 'Newly Launched', stage: 'mainnet_live', launchStatus: 'Recently launched', description: 'New Base token with a live pool, launched in the last 24 hours.', website: 'https://nimbus.cash', source: 'DexScreener', launchedAgoDays: 1 },
  { name: 'Lumen Protocol', symbol: 'LMN', chain: 'Ethereum', category: 'DeFi', stage: 'launching_soon', launchStatus: 'Newly Listed', description: 'Cross-margin lending protocol newly listed on aggregators.', website: 'https://lumenprotocol.io', twitter: 'https://x.com/lumenprotocol', communitySize: 4200, source: 'CoinGecko' },
  { name: 'Solstice SDK', symbol: '', chain: 'Solana', category: 'Infrastructure', stage: 'building', launchStatus: 'Active development', description: 'Open-source Rust SDK for building Solana programs faster.', github: 'https://github.com/solstice-labs/solstice', website: 'https://solstice.dev', communitySize: 1300, source: 'GitHub' },
  { name: 'Nova Markets', symbol: 'NOVA', chain: 'Solana', category: 'DEX', stage: 'pre_sale', launchStatus: 'Presale', description: 'High-throughput orderbook DEX built for the Solana ecosystem.', website: 'https://novamarkets.xyz', telegram: 'https://t.me/novamarkets', communitySize: 5600, source: 'Solana Ecosystem' },
  { name: 'Coral Social', symbol: 'CORAL', chain: 'Base', category: 'SocialFi', stage: 'launching_soon', launchStatus: 'Launching soon', description: 'Onchain social graph and creator monetization on Base.', website: 'https://coral.social', twitter: 'https://x.com/coralsocial', communitySize: 3400, source: 'Base Ecosystem' },
  { name: 'Frostbyte Games', symbol: 'FRB', chain: 'Avalanche', category: 'Gaming', stage: 'pre_sale', launchStatus: 'Whitelist open', description: 'On-chain strategy game running on an Avalanche subnet.', website: 'https://frostbyte.gg', telegram: 'https://t.me/frostbyte', communitySize: 7200, source: 'Avalanche Ecosystem' },
  { name: 'Cascade Rollup', symbol: '', chain: 'Ethereum', category: 'Layer 2', stage: 'testnet', launchStatus: 'Devnet', description: 'ZK rollup for high-frequency apps, currently on public testnet.', website: 'https://cascade.build', github: 'https://github.com/cascade-rollup/node', source: 'Testnet Projects' },
];

function slugifyClient(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project';
}

function hashClient(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function normNameClient(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function siteHostClient(value) {
  try { return new URL(String(value)).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

function signaturesClient(p) {
  const sigs = [];
  const n = normNameClient(p.name); if (n) sigs.push(`name:${n}`);
  const sym = String(p.symbol || '').trim().toUpperCase(); if (sym) sigs.push(`sym:${sym}`);
  const host = siteHostClient(p.website); if (host) sigs.push(`site:${host}`);
  const ca = String(p.contractAddress || '').trim().toLowerCase(); if (ca) sigs.push(`ca:${ca}`);
  return sigs;
}

// Build normalized discovered projects and drop any that collide (by name /
// symbol / website / contract) with the manually submitted ones - mirroring
// the server engine's dedupe so dev matches production behavior.
function buildDiscoveredFallback(manualVisible) {
  const now = new Date().toISOString();
  const seen = new Set();
  for (const p of manualVisible) for (const s of signaturesClient(p)) seen.add(s);
  const out = [];
  for (const raw of DISCOVERY_MOCK_SEED) {
    const project = {
      id: `esd-${slugifyClient(raw.name)}-${hashClient(`${normNameClient(raw.name)}|${raw.source || ''}`)}`,
      origin: 'discovered',
      source: raw.source || 'Discovery',
      sourceUrl: raw.website || raw.github || '',
      discoveredAt: now,
      launchedAt: raw.launchedAt || (raw.launchedAgoDays != null ? new Date(Date.now() - raw.launchedAgoDays * 86400000).toISOString() : ''),
      name: raw.name,
      symbol: String(raw.symbol || '').toUpperCase(),
      logoUrl: raw.logoUrl || '',
      description: raw.description || '',
      stage: raw.stage || 'idea',
      launchStatus: raw.launchStatus || '',
      estimatedLaunch: raw.estimatedLaunch || '',
      chain: raw.chain || '',
      category: raw.category || '',
      website: raw.website || '',
      twitter: raw.twitter || '',
      telegram: raw.telegram || '',
      discord: raw.discord || '',
      github: raw.github || '',
      contractAddress: raw.contractAddress || '',
      communitySize: Math.max(0, Number(raw.communitySize) || 0),
      teamVerified: false,
      buildingProgress: 0,
      builtWithLaunchpad: false,
      launchpadUrl: '',
      featured: false,
      overview: '', roadmap: [], team: [], progressTimeline: [], milestones: [],
      whyEarlyStage: '', riskNotes: '',
      createdAt: now, updatedAt: now,
    };
    const sigs = signaturesClient(project);
    if (sigs.some((s) => seen.has(s))) continue;
    for (const s of sigs) seen.add(s);
    out.push(project);
  }
  return out;
}

// ---- Public API ----------------------------------------------------------

export async function submitEarlyStageProject(payload) {
  try {
    return await callFunction('early-stage-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (!isFunctionUnavailable(error)) throw error;
    const store = readFallbackStore();
    const project = buildLocalProject(payload);
    store.projects = [project, ...store.projects];
    writeFallbackStore(store);
    return { ok: true, projectId: project.id, project: { id: project.id, name: project.name, status: project.status, createdAt: project.createdAt }, fallback: true };
  }
}

export async function fetchEarlyStageProjects({ stage = 'all', chain = 'all', category = 'all', search = '', origin = 'all' } = {}) {
  const params = new URLSearchParams({ stage, chain, category });
  if (search) params.set('search', search);
  if (origin && origin !== 'all') params.set('origin', origin);
  try {
    return await callFunction(`early-stage-list?${params.toString()}`);
  } catch (error) {
    if (!isFunctionUnavailable(error)) throw error;
    const store = readFallbackStore();
    const manualVisible = store.projects.filter(isVisible).map((p) => ({ ...p, origin: p.origin || 'community' }));
    // Merge in auto-discovered mocks (deduped against manual), mirroring the
    // server's merged list so the dev experience matches production.
    const discovered = buildDiscoveredFallback(manualVisible);
    let visible = [...manualVisible, ...discovered];
    if (origin !== 'all') visible = visible.filter((p) => (p.origin || 'community') === origin);
    if (stage !== 'all') visible = visible.filter((p) => p.stage === stage);
    if (chain !== 'all') visible = visible.filter((p) => (p.chain || '').toLowerCase() === chain.toLowerCase());
    if (category !== 'all') visible = visible.filter((p) => (p.category || '').toLowerCase() === category.toLowerCase());
    if (search) {
      const needle = search.toLowerCase();
      visible = visible.filter((p) =>
        [p.name, p.description, p.chain, p.category, p.launchStatus].filter(Boolean).some((f) => f.toLowerCase().includes(needle))
      );
    }
    visible = [...visible].sort((a, b) => {
      if (Boolean(b.featured) !== Boolean(a.featured)) return b.featured ? 1 : -1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    const merged = [...manualVisible, ...discovered];
    const facets = {
      stages: [...new Set(merged.map((p) => p.stage).filter(Boolean))],
      chains: [...new Set(merged.map((p) => p.chain).filter(Boolean))],
      categories: [...new Set(merged.map((p) => p.category).filter(Boolean))],
      sources: [...new Set(discovered.map((p) => p.source).filter(Boolean))],
    };
    return { projects: visible, facets, counts: { manual: manualVisible.length, discovered: discovered.length }, total: visible.length };
  }
}

export async function fetchEarlyStageProject(id) {
  try {
    const data = await callFunction(`early-stage-get?id=${encodeURIComponent(id)}`);
    return data.project;
  } catch (error) {
    if (!isFunctionUnavailable(error)) throw error;
    const store = readFallbackStore();
    // Discovered project ids ('esd-') resolve from the same mock discovery set
    // the list fallback builds (deduped against manual submissions).
    if (String(id).startsWith('esd-')) {
      const manualVisible = store.projects.filter(isVisible).map((p) => ({ ...p, origin: p.origin || 'community' }));
      const found = buildDiscoveredFallback(manualVisible).find((p) => p.id === id);
      return found || null;
    }
    const project = store.projects.find((p) => p.id === id);
    return project && isVisible(project) ? { ...project, origin: project.origin || 'community' } : null;
  }
}

// ---- Admin API -----------------------------------------------------------

export async function fetchEarlyStageAdmin(token, { status = 'all', search = '' } = {}) {
  const params = new URLSearchParams({ status });
  if (search) params.set('search', search);
  try {
    return await callFunction(`early-stage-admin-list?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    if (!isFunctionUnavailable(error) || !token.startsWith('dev-fallback-')) throw error;
    const store = readFallbackStore();
    let projects = store.projects;
    if (status !== 'all') projects = projects.filter((p) => p.status === status);
    if (search) {
      const needle = search.toLowerCase();
      projects = projects.filter((p) =>
        [p.name, p.description, p.chain, p.category, p.contactEmail, p.submittedByWallet, p.id]
          .filter(Boolean)
          .some((f) => f.toLowerCase().includes(needle))
      );
    }
    projects = [...projects].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const all = store.projects;
    const stats = {
      total: all.length,
      pending: all.filter((p) => p.status === 'pending').length,
      approved: all.filter((p) => p.status === 'approved').length,
      rejected: all.filter((p) => p.status === 'rejected').length,
      archived: all.filter((p) => p.status === 'archived').length,
      featured: all.filter((p) => p.featured).length,
    };
    return { projects, stats };
  }
}

async function performAdminAction(token, body) {
  try {
    return await callFunction('early-stage-admin-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (!isFunctionUnavailable(error) || !token.startsWith('dev-fallback-')) throw error;
    const store = readFallbackStore();
    const index = store.projects.findIndex((p) => p.id === body.projectId);
    if (index === -1) throw new Error('Project not found.');
    const project = store.projects[index];
    const now = new Date().toISOString();
    switch (body.action) {
      case 'approve': project.status = 'approved'; break;
      case 'reject': project.status = 'rejected'; break;
      case 'archive': project.status = 'archived'; break;
      case 'feature': project.featured = true; break;
      case 'unfeature': project.featured = false; break;
      case 'hide': project.hidden = true; break;
      case 'unhide': project.hidden = false; break;
      case 'set_notes': project.adminNotes = String(body.adminNotes || '').slice(0, 5000); break;
      case 'edit': {
        const rebuilt = buildLocalProject(body.updates || {}, {
          id: project.id, status: project.status, featured: project.featured,
          hidden: project.hidden, adminNotes: project.adminNotes, createdAt: project.createdAt,
        });
        store.projects[index] = rebuilt;
        writeFallbackStore(store);
        return { ok: true, project: rebuilt };
      }
      case 'delete': {
        store.projects = store.projects.filter((p) => p.id !== body.projectId);
        writeFallbackStore(store);
        return { ok: true, deleted: true };
      }
      default: throw new Error('Unknown action.');
    }
    project.updatedAt = now;
    store.projects[index] = project;
    writeFallbackStore(store);
    return { ok: true, project };
  }
}

export const approveEarlyStage = (token, projectId) => performAdminAction(token, { action: 'approve', projectId });
export const rejectEarlyStage = (token, projectId) => performAdminAction(token, { action: 'reject', projectId });
export const archiveEarlyStage = (token, projectId) => performAdminAction(token, { action: 'archive', projectId });
export const featureEarlyStage = (token, projectId, on) => performAdminAction(token, { action: on ? 'feature' : 'unfeature', projectId });
export const hideEarlyStage = (token, projectId, on) => performAdminAction(token, { action: on ? 'hide' : 'unhide', projectId });
export const setEarlyStageNotes = (token, projectId, adminNotes) => performAdminAction(token, { action: 'set_notes', projectId, adminNotes });
export const editEarlyStage = (token, projectId, updates) => performAdminAction(token, { action: 'edit', projectId, updates });
export const deleteEarlyStage = (token, projectId) => performAdminAction(token, { action: 'delete', projectId });
