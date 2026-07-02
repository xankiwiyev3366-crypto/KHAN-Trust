// GET /.netlify/functions/early-stage-get?id=... - public single early-stage
// project profile. Returns the full public profile (overview, roadmap, team,
// timeline, milestones, risk notes, why-early-stage) but never the admin-only
// contact fields. Only returns projects that are approved + visible.
import {
  readEarlyStageProjects,
  isPubliclyVisible,
  jsonResponse,
} from './_earlyStageStore.mjs';

function toPublicProfile(project) {
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
    overview: project.overview,
    roadmap: project.roadmap || [],
    team: project.team || [],
    progressTimeline: project.progressTimeline || [],
    milestones: project.milestones || [],
    whyEarlyStage: project.whyEarlyStage,
    riskNotes: project.riskNotes,
    featured: project.featured,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt || project.createdAt,
    // Future-ready fields (reserved).
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
    const id = event.queryStringParameters?.id || '';
    if (!id) {
      return jsonResponse(400, { message: 'A project id is required.' });
    }
    const all = await readEarlyStageProjects();
    const project = all.find((p) => p.id === id);
    if (!project || !isPubliclyVisible(project)) {
      return jsonResponse(404, { message: 'Project not found.' });
    }
    return jsonResponse(200, { project: toPublicProfile(project) });
  } catch (error) {
    return jsonResponse(500, { message: `early-stage-get crashed: ${error.message}`, stack: error.stack });
  }
}
