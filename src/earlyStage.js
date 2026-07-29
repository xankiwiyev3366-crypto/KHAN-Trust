// "Early Stage Projects" feature - client module. Mirrors report.js: real
// calls go to netlify/functions/early-stage-*.
//
// IN DEVELOPMENT ONLY, when those functions are unreachable (plain `vite dev`,
// no Netlify Functions server), calls fall back to a localStorage-backed store
// with the same shape so the flow is testable end-to-end. That fallback is
// gated by isDevFunctionUnavailable() and is compiled out of the production
// bundle entirely — see src/devFallback.js for what it used to do in
// production and why that was wrong.
//
// Fully additive: this module is only imported by the lazy-loaded Early Stage
// UI. It touches no existing store, API, or route.
import { isDevFunctionUnavailable } from './devFallback.js';

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

// ---- Curated first-party projects ----------------------------------------
// Mirror of netlify/functions/_curatedProjects.mjs: the server merges these into
// the real list at read time; this copy powers the no-Functions dev fallback so
// KHAN is present and searchable in plain `vite dev` too. KHAN is genuinely
// pre-launch ($KHAN contract "coming soon"), so it belongs in Early Stage.
//
// KEEP THIS RECORD BYTE-EQUIVALENT TO THE SERVER'S. It is a mirror, and the
// conflict-of-interest corrections applied there (teamVerified false, no
// holder-utility claim, explicit self-listing disclosure in riskNotes) are the
// whole point — a dev fallback that still showed KHAN a self-granted "Verified
// team" badge would be a fixture that contradicts production. The reasoning
// lives in the server module's header; do not restate it, do not diverge.
const CURATED_PROJECTS = [
  {
    id: 'esc-khan-trust',
    origin: 'community',
    curated: true,
    name: 'KHAN Trust',
    symbol: 'KHAN',
    logoUrl: '/favicon.svg',
    description: 'AI-powered crypto trust scoring, community-first project profiles, and public risk signals. Listed here by KHAN Trust itself, which also operates this directory.',
    stage: 'live_platform',
    launchStatus: 'Building in public',
    estimatedLaunch: '',
    chain: 'Solana',
    category: 'Infrastructure',
    website: 'https://khantrust.net',
    twitter: 'https://x.com/KhanPortall',
    telegram: 'https://t.me/+RXCuwpSNwikzNTE0',
    discord: '',
    github: 'https://github.com/khantrust',
    contractAddress: '',
    communitySize: 1280,
    teamVerified: false,
    buildingProgress: 65,
    builtWithLaunchpad: false,
    launchpadUrl: '',
    featured: true,
    overview: 'KHAN Trust turns raw on-chain and social data into explainable trust scores and public profiles for crypto projects. The $KHAN token is a separate community token, is not live yet, and grants no access to any part of the platform.',
    roadmap: [
      { title: 'Phase 1 - KHAN Community', detail: 'In progress' },
      { title: 'Phase 2 - KHAN Trust Portal', detail: 'Completed', done: true },
      { title: 'Phase 3 - Project trust profiles', detail: 'In progress' },
    ],
    team: [], progressTimeline: [], milestones: [],
    whyEarlyStage: 'The $KHAN token contract is not live yet ("coming soon"), so KHAN is listed here as a pre-launch project building trust in the open ahead of its public token launch.',
    riskNotes: 'KHAN Trust operates this directory and listed this entry itself. It was not submitted by a third party, was not auto-discovered, and has not passed the wallet-signature verification that other projects must complete.',
    source: '', sourceUrl: '', discoveredAt: '', launchedAt: '',
    createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
  },
];

function curatedSigs() {
  const set = new Set();
  for (const p of CURATED_PROJECTS) {
    const n = normNameClient(p.name); if (n) set.add(`name:${n}`);
    const s = String(p.symbol || '').trim().toUpperCase(); if (s) set.add(`sym:${s}`);
  }
  return set;
}

function collidesCurated(p, sigs) {
  const n = normNameClient(p.name); if (n && sigs.has(`name:${n}`)) return true;
  const s = String(p.symbol || '').trim().toUpperCase(); if (s && sigs.has(`sym:${s}`)) return true;
  return false;
}

// ---- Auto-discovery ------------------------------------------------------
// Discovery lives ENTIRELY server-side (netlify/functions/_discoveryProviders +
// _discoveryEngine + early-stage-discover-run); the list endpoint returns
// manual + discovered already merged.
//
// A client-side mirror of ~8 invented projects used to live here as a dev
// fallback. It has been deleted along with the server-side mock providers it
// mirrored. It was compiled into the PRODUCTION bundle and rendered whenever
// the early-stage-list call failed, so a transient function error showed real
// visitors invented projects attributed to DexScreener and CoinGecko.
//
// The dev fallback below now serves only genuinely local data: curated
// first-party records and whatever the developer submitted into localStorage.
// It discovers nothing, because a browser with no Functions server cannot
// discover anything, and saying otherwise was the bug.

function normNameClient(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
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
    if (!isDevFunctionUnavailable(error)) throw error;
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
    if (!isDevFunctionUnavailable(error)) throw error;
    const store = readFallbackStore();
    // Curated first-party projects (KHAN) are always present and win over any
    // manual/discovered collision, mirroring the server.
    const sigs = curatedSigs();
    const manualVisible = store.projects
      .filter(isVisible)
      .map((p) => ({ ...p, origin: p.origin || 'community' }))
      .filter((p) => !collidesCurated(p, sigs));
    // No discovered projects: discovery is a server-side network job and this
    // branch runs precisely when the server is unreachable. Reporting an empty
    // discovered set is the honest answer — see the auto-discovery note above.
    const discovered = [];
    let visible = [...CURATED_PROJECTS, ...manualVisible, ...discovered];
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
    const merged = [...CURATED_PROJECTS, ...manualVisible, ...discovered];
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
    if (!isDevFunctionUnavailable(error)) throw error;
    const store = readFallbackStore();
    // Curated project ids ('esc-') resolve from the in-code curated list.
    if (String(id).startsWith('esc-')) {
      return CURATED_PROJECTS.find((p) => p.id === id) || null;
    }
    // Discovered project ids ('esd-') are produced only by the server-side
    // discovery engine. With the server unreachable there is nothing local to
    // resolve them against, so this is a genuine "not found" rather than a
    // reason to invent a record.
    if (String(id).startsWith('esd-')) {
      return null;
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
    if (!isDevFunctionUnavailable(error) || !token.startsWith('dev-fallback-')) throw error;
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
    if (!isDevFunctionUnavailable(error) || !token.startsWith('dev-fallback-')) throw error;
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
