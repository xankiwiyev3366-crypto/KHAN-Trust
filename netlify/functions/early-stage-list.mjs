// GET /.netlify/functions/early-stage-list - public listing of approved,
// visible early-stage projects. Optional filters: stage, chain, category,
// search. Featured projects are sorted first, then by newest. Admin-only
// contact fields are stripped before returning.
import {
  readEarlyStageProjects,
  isPubliclyVisible,
  jsonResponse,
} from './_earlyStageStore.mjs';
import { readDiscoveredProjects } from './_discoveryStore.mjs';

// Fields safe to expose publicly - deliberately omits contactName/contactEmail
// /submittedByWallet/adminNotes.
function toPublic(project) {
  return {
    id: project.id,
    name: project.name,
    symbol: project.symbol || '',
    logoUrl: project.logoUrl,
    description: project.description,
    stage: project.stage,
    launchStatus: project.launchStatus,
    estimatedLaunch: project.estimatedLaunch,
    chain: project.chain,
    category: project.category,
    website: project.website,
    twitter: project.twitter,
    telegram: project.telegram,
    discord: project.discord,
    communitySize: project.communitySize,
    teamVerified: project.teamVerified,
    buildingProgress: project.buildingProgress,
    builtWithLaunchpad: project.builtWithLaunchpad,
    launchpadUrl: project.launchpadUrl,
    featured: project.featured,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt || project.createdAt,
    // Phase 2: origin distinguishes manually submitted ('community') from
    // auto-discovered ('discovered') projects. Manual records predate this
    // field, so default them to 'community'.
    origin: project.origin || 'community',
    source: project.source || '',
    sourceUrl: project.sourceUrl || '',
    github: project.github || '',
    discoveredAt: project.discoveredAt || '',
    // Real on-chain launch date (ISO) when known; drives the "New / Recently
    // launched" badge. Empty for manual/older records - never used to hide.
    launchedAt: project.launchedAt || '',
    // Future-ready fields (reserved) - safe to expose; empty until populated.
    saleType: project.saleType || '',
    countdownAt: project.countdownAt || '',
    communityVotes: project.communityVotes || 0,
  };
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }

    // Manual (approved + visible) projects and the auto-discovered cache are
    // read in parallel and merged. Both are single fast blob reads - discovery
    // does its network work in the background worker, never here. If the
    // discovered cache is unavailable it simply contributes nothing.
    const [all, discoveredRaw] = await Promise.all([
      readEarlyStageProjects(),
      readDiscoveredProjects().catch(() => []),
    ]);
    const stage = event.queryStringParameters?.stage || 'all';
    const chain = event.queryStringParameters?.chain || 'all';
    const category = event.queryStringParameters?.category || 'all';
    const search = (event.queryStringParameters?.search || '').trim().toLowerCase();
    const origin = event.queryStringParameters?.origin || 'all';

    const manualVisible = all.filter(isPubliclyVisible).map((p) => ({ ...p, origin: p.origin || 'community' }));
    // Discovered projects are inherently public (sourced from public data) and
    // are never auto-verified. Guard teamVerified just in case a provider set it.
    const discovered = (Array.isArray(discoveredRaw) ? discoveredRaw : []).map((p) => ({
      ...p,
      origin: 'discovered',
      teamVerified: false,
    }));
    let visible = [...manualVisible, ...discovered];
    if (origin !== 'all') visible = visible.filter((p) => (p.origin || 'community') === origin);
    if (stage !== 'all') visible = visible.filter((p) => p.stage === stage);
    if (chain !== 'all') visible = visible.filter((p) => (p.chain || '').toLowerCase() === chain.toLowerCase());
    if (category !== 'all') visible = visible.filter((p) => (p.category || '').toLowerCase() === category.toLowerCase());
    if (search) {
      visible = visible.filter((p) =>
        [p.name, p.description, p.chain, p.category, p.launchStatus]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(search))
      );
    }

    visible.sort((a, b) => {
      if (Boolean(b.featured) !== Boolean(a.featured)) return b.featured ? 1 : -1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    // Facets reflect the full merged public set (manual + discovered) so the
    // UI can offer every stage/chain/category/source that actually exists.
    const merged = [...manualVisible, ...discovered];
    const stages = [...new Set(merged.map((p) => p.stage).filter(Boolean))];
    const chains = [...new Set(merged.map((p) => p.chain).filter(Boolean))];
    const categories = [...new Set(merged.map((p) => p.category).filter(Boolean))];
    const sources = [...new Set(discovered.map((p) => p.source).filter(Boolean))];

    return jsonResponse(200, {
      projects: visible.map(toPublic),
      facets: { stages, chains, categories, sources },
      counts: { manual: manualVisible.length, discovered: discovered.length },
      total: visible.length,
    });
  } catch (error) {
    return jsonResponse(500, { message: `early-stage-list crashed: ${error.message}`, stack: error.stack });
  }
}
