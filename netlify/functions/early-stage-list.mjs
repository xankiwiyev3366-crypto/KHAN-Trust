// GET /.netlify/functions/early-stage-list - public listing of approved,
// visible early-stage projects. Optional filters: stage, chain, category,
// search. Featured projects are sorted first, then by newest. Admin-only
// contact fields are stripped before returning.
import {
  readEarlyStageProjects,
  isPubliclyVisible,
  jsonResponse,
} from './_earlyStageStore.mjs';

// Fields safe to expose publicly - deliberately omits contactName/contactEmail
// /submittedByWallet/adminNotes.
function toPublic(project) {
  return {
    id: project.id,
    name: project.name,
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
  };
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }

    const all = await readEarlyStageProjects();
    const stage = event.queryStringParameters?.stage || 'all';
    const chain = event.queryStringParameters?.chain || 'all';
    const category = event.queryStringParameters?.category || 'all';
    const search = (event.queryStringParameters?.search || '').trim().toLowerCase();

    let visible = all.filter(isPubliclyVisible);
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

    const stages = [...new Set(all.filter(isPubliclyVisible).map((p) => p.stage).filter(Boolean))];
    const chains = [...new Set(all.filter(isPubliclyVisible).map((p) => p.chain).filter(Boolean))];
    const categories = [...new Set(all.filter(isPubliclyVisible).map((p) => p.category).filter(Boolean))];

    return jsonResponse(200, {
      projects: visible.map(toPublic),
      facets: { stages, chains, categories },
      total: visible.length,
    });
  } catch (error) {
    return jsonResponse(500, { message: `early-stage-list crashed: ${error.message}`, stack: error.stack });
  }
}
