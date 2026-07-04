// POST /.netlify/functions/early-stage-submit - a project team submits their
// early-stage (pre-launch) project to be listed in the KHAN Trust "Early Stage
// Projects" section. Public endpoint (no auth): validates, sanitizes, rate
// limits, and stores as `status: 'pending'` awaiting admin approval. Mirrors
// report-submit.mjs so the two systems behave consistently.
import {
  readEarlyStageProjects,
  writeEarlyStageProjects,
  checkAndRecordRateLimit,
  getClientIp,
  sanitizeText,
  VALID_STAGES,
  jsonResponse,
} from './_earlyStageStore.mjs';

const MAX = {
  name: 120,
  description: 400,
  overview: 4000,
  chain: 60,
  category: 60,
  launchStatus: 80,
  estimatedLaunch: 40,
  url: 300,
  whyEarlyStage: 2000,
  riskNotes: 2000,
  text: 500,
  launchpadUrl: 300,
  symbol: 20,
  saleType: 40,
  countdownAt: 40,
};

const URL_PATTERN = /^https?:\/\//i;

function sanitizeUrl(value) {
  const clean = sanitizeText(value, MAX.url);
  if (!clean) return '';
  return URL_PATTERN.test(clean) ? clean : '';
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project';
}

function generateId(name) {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `es-${slugify(name)}-${stamp}${random}`;
}

// Accepts an array of {title, detail} style entries (roadmap, team, timeline,
// milestones) and returns a clean, length-capped version. Tolerant of strings.
function sanitizeEntries(list, max = 12) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, max).map((item) => {
    if (typeof item === 'string') return { title: sanitizeText(item, MAX.text), detail: '' };
    return {
      title: sanitizeText(item?.title, MAX.text),
      detail: sanitizeText(item?.detail, MAX.text),
      done: Boolean(item?.done),
    };
  }).filter((entry) => entry.title || entry.detail);
}

// The canonical shape of a stored early-stage project. Reused conceptually by
// the admin edit action (early-stage-admin-action).
export function buildEarlyStageProject(payload, meta = {}) {
  const stage = VALID_STAGES.includes(payload.stage) ? payload.stage : 'idea';
  const now = new Date().toISOString();
  const progress = Math.max(0, Math.min(100, Number(payload.buildingProgress) || 0));
  const community = Math.max(0, Number(payload.communitySize) || 0);
  return {
    id: meta.id || generateId(payload.name),
    name: sanitizeText(payload.name, MAX.name),
    symbol: sanitizeText(payload.symbol, MAX.symbol).toUpperCase(),
    logoUrl: sanitizeUrl(payload.logoUrl),
    description: sanitizeText(payload.description, MAX.description),
    stage,
    launchStatus: sanitizeText(payload.launchStatus, MAX.launchStatus),
    estimatedLaunch: sanitizeText(payload.estimatedLaunch, MAX.estimatedLaunch),
    chain: sanitizeText(payload.chain, MAX.chain),
    category: sanitizeText(payload.category, MAX.category),
    website: sanitizeUrl(payload.website),
    twitter: sanitizeUrl(payload.twitter),
    telegram: sanitizeUrl(payload.telegram),
    discord: sanitizeUrl(payload.discord),
    communitySize: community,
    teamVerified: Boolean(payload.teamVerified),
    buildingProgress: progress,
    builtWithLaunchpad: Boolean(payload.builtWithLaunchpad),
    launchpadUrl: sanitizeUrl(payload.launchpadUrl),
    // Rich profile sections
    overview: sanitizeText(payload.overview, MAX.overview),
    roadmap: sanitizeEntries(payload.roadmap),
    team: sanitizeEntries(payload.team),
    progressTimeline: sanitizeEntries(payload.progressTimeline),
    milestones: sanitizeEntries(payload.milestones),
    whyEarlyStage: sanitizeText(payload.whyEarlyStage, MAX.whyEarlyStage),
    riskNotes: sanitizeText(payload.riskNotes, MAX.riskNotes),
    // Contact (admin-only, never returned to public list)
    contactName: sanitizeText(payload.contactName, MAX.name),
    contactEmail: sanitizeText(payload.contactEmail, MAX.url),
    submittedByWallet: sanitizeText(payload.wallet, 64),
    // Future-ready schema (reserved - not surfaced in the UI yet). These are
    // stored so upcoming investor features can populate them without a data
    // migration: funding rounds, sale phase, launch countdown, community
    // voting, AI launch-readiness analysis, and investor watchlist counts.
    // Scalars are accepted/sanitized now; structured payloads (funding,
    // aiLaunchReadiness) stay null until their features define a shape.
    funding: meta.funding ?? null,               // { round, raisedUsd, targetUsd, currency }
    saleType: sanitizeText(payload.saleType, MAX.saleType), // 'seed' | 'private_sale' | 'public_sale'
    countdownAt: sanitizeText(payload.countdownAt, MAX.countdownAt), // ISO launch datetime
    communityVotes: Math.max(0, Number(payload.communityVotes) || 0),
    aiLaunchReadiness: meta.aiLaunchReadiness ?? null, // { score, notes }
    investorWatchCount: Math.max(0, Number(meta.investorWatchCount) || 0),
    // Admin/meta - always server-controlled, never trusted from payload
    status: meta.status || 'pending',
    featured: meta.featured ?? false,
    hidden: meta.hidden ?? false,
    adminNotes: meta.adminNotes || '',
    createdAt: meta.createdAt || now,
    updatedAt: now,
  };
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { reason: 'method_not_allowed', message: 'Method not allowed' });
    }

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { reason: 'invalid_body', message: 'Invalid request body' });
    }

    // Honeypot: a hidden field real users never fill in. Respond as if
    // successful (don't tip off the bot) but never actually store it.
    if (String(payload.company || '').trim()) {
      return jsonResponse(200, { ok: true, projectId: generateId(payload.name) });
    }

    const name = sanitizeText(payload.name, MAX.name);
    const description = sanitizeText(payload.description, MAX.description);
    if (!name) {
      return jsonResponse(400, { reason: 'name_required', message: 'Project name is required.' });
    }
    if (!description) {
      return jsonResponse(400, { reason: 'description_required', message: 'A short description is required.' });
    }
    if (payload.stage && !VALID_STAGES.includes(payload.stage)) {
      return jsonResponse(400, { reason: 'invalid_stage', message: 'A valid project stage is required.' });
    }

    const ip = getClientIp(event);
    const allowed = await checkAndRecordRateLimit(ip);
    if (!allowed) {
      return jsonResponse(429, { reason: 'rate_limited', message: 'Too many submissions. Please try again later.' });
    }

    const project = buildEarlyStageProject(payload);
    const projects = await readEarlyStageProjects();
    await writeEarlyStageProjects([project, ...projects]);

    return jsonResponse(200, {
      ok: true,
      projectId: project.id,
      project: { id: project.id, name: project.name, status: project.status, createdAt: project.createdAt },
    });
  } catch (error) {
    return jsonResponse(500, { reason: 'server_error', message: `early-stage-submit crashed: ${error.message}` });
  }
}
