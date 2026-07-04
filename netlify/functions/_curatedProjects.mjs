// Curated / first-party Early Stage projects that must ALWAYS be present in the
// public list, independent of the Blobs submission store and the discovery
// providers. The headline case is KHAN itself: $KHAN is genuinely pre-launch
// (its contract is "coming soon"), so it meets the Early Stage criteria, but it
// was never submitted or auto-discovered - which is why searching "KHAN"
// returned nothing.
//
// These records are merged in at READ time by early-stage-list / early-stage-get
// (never written to the submission store, so they can't be lost or edited away),
// and are deduped so a later manual submission or auto-discovery of the same
// project can never create a duplicate. Curated projects are first-party, shown
// verified + featured, and use the 'esc-' id prefix.
//
// The client mirrors this list in src/earlyStage.js for the no-Functions dev
// fallback, the same way the discovery mock seed is mirrored there.

const STABLE_TS = '2026-06-01T00:00:00.000Z';

export const CURATED_PROJECTS = [
  {
    id: 'esc-khan-trust',
    origin: 'community',
    curated: true,
    name: 'KHAN Trust',
    symbol: 'KHAN',
    logoUrl: '/favicon.svg',
    description: 'AI-powered crypto trust scoring, community-first project profiles, and public risk signals - plus the $KHAN token powering future holder utility across the KHAN ecosystem.',
    // 'live_platform' is a curated-only status: the KHAN Trust platform is live
    // while the $KHAN token is still pre-launch. It is not part of the
    // submission stage vocabulary (VALID_STAGES) - curated records bypass that
    // validation - and its badge label lives under i18n stages.live_platform.
    stage: 'live_platform',
    launchStatus: 'Building in public',
    estimatedLaunch: '',
    chain: 'Solana',
    category: 'Infrastructure',
    website: 'https://khantrust.net',
    twitter: 'https://x.com/KXankiwiyev3366',
    telegram: 'https://t.me/+RXCuwpSNwikzNTE0',
    discord: '',
    github: 'https://github.com/khantrust',
    contractAddress: '',
    communitySize: 1280,
    teamVerified: true,
    buildingProgress: 65,
    builtWithLaunchpad: false,
    launchpadUrl: '',
    featured: true,
    overview: 'KHAN Trust turns raw on-chain and social data into explainable trust scores and public profiles for crypto projects. The $KHAN token underpins future holder utility across the ecosystem and is not live yet, so KHAN is building trust in the open ahead of its public token launch.',
    roadmap: [
      { title: 'Phase 1 - KHAN Community', detail: 'In progress' },
      { title: 'Phase 2 - KHAN Trust Portal', detail: 'Completed', done: true },
      { title: 'Phase 3 - Project trust profiles', detail: 'In progress' },
    ],
    team: [],
    progressTimeline: [],
    milestones: [],
    whyEarlyStage: 'The $KHAN token contract is not live yet ("coming soon"), so KHAN is listed here as a pre-launch project building trust in the open ahead of its public token launch.',
    riskNotes: '',
    source: '',
    sourceUrl: '',
    discoveredAt: '',
    launchedAt: '',
    createdAt: STABLE_TS,
    updatedAt: STABLE_TS,
  },
];

// name -> comparable key, matching the discovery engine's normName so dedupe is
// consistent across curated / manual / discovered records.
function normName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// The name/symbol signatures curated projects occupy. A manual or discovered
// project that shares ANY of these is dropped in favor of the curated record
// (curated is the first-party source of truth - same "curated wins" rule the
// engine already applies for manual-vs-discovered).
export function curatedSignatureSet() {
  const set = new Set();
  for (const p of CURATED_PROJECTS) {
    const n = normName(p.name);
    if (n) set.add(`name:${n}`);
    const s = String(p.symbol || '').trim().toUpperCase();
    if (s) set.add(`sym:${s}`);
  }
  return set;
}

// True if a project collides (by name or symbol) with any curated project.
export function collidesWithCurated(project, curatedSigs) {
  const n = normName(project.name);
  if (n && curatedSigs.has(`name:${n}`)) return true;
  const s = String(project.symbol || '').trim().toUpperCase();
  if (s && curatedSigs.has(`sym:${s}`)) return true;
  return false;
}

export function findCuratedById(id) {
  return CURATED_PROJECTS.find((p) => p.id === id) || null;
}
