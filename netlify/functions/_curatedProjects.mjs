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
// project can never create a duplicate. Curated projects use the 'esc-' prefix.
//
// THE CONFLICT OF INTEREST, AND WHERE THE LINE IS
//
// This list lets KHAN Trust place its own project into a list KHAN Trust
// curates. That is defensible for PLACEMENT — an operator choosing what appears
// in their own directory is ordinary, and `featured` says exactly that out loud.
// It is NOT defensible for a TRUST CLAIM. The record used to carry
// `teamVerified: true`, which renders the same "Verified team" check that every
// other project can only earn by connecting the owning wallet, signing a
// verification message, and passing admin review (verification-request →
// verification-admin-review). KHAN did none of that. It wrote the flag.
//
// A platform selling verification cannot grant itself the badge it sells. The
// flag is now false, and it can only become true the way everyone else's does.
// The rule for anything added here: state facts, claim no status.
//
// The client mirrors this list in src/earlyStage.js for the no-Functions dev
// fallback.

const STABLE_TS = '2026-06-01T00:00:00.000Z';

export const CURATED_PROJECTS = [
  {
    id: 'esc-khan-trust',
    origin: 'community',
    curated: true,
    name: 'KHAN Trust',
    symbol: 'KHAN',
    logoUrl: '/favicon.svg',
    description: 'AI-powered crypto trust scoring, community-first project profiles, and public risk signals. Listed here by KHAN Trust itself, which also operates this directory.',
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
    twitter: 'https://x.com/KhanPortall',
    telegram: 'https://t.me/+RXCuwpSNwikzNTE0',
    discord: '',
    github: 'https://github.com/khantrust',
    contractAddress: '',
    communitySize: 1280,
    // FALSE, AND ONLY EARNABLE. See the conflict-of-interest note in the header:
    // this was true, self-granted, and rendered the same "Verified team" badge
    // other projects must prove ownership and pass admin review to display.
    teamVerified: false,
    buildingProgress: 65,
    builtWithLaunchpad: false,
    launchpadUrl: '',
    featured: true,
    // No holder-utility claim. The rest of the product stopped saying the token
    // "underpins future holder utility" because it does not gate anything and
    // never has; this record does not get to keep saying it.
    overview: 'KHAN Trust turns raw on-chain and social data into explainable trust scores and public profiles for crypto projects. The $KHAN token is a separate community token, is not live yet, and grants no access to any part of the platform.',
    roadmap: [
      { title: 'Phase 1 - KHAN Community', detail: 'In progress' },
      { title: 'Phase 2 - KHAN Trust Portal', detail: 'Completed', done: true },
      { title: 'Phase 3 - Project trust profiles', detail: 'In progress' },
    ],
    team: [],
    progressTimeline: [],
    milestones: [],
    whyEarlyStage: 'The $KHAN token contract is not live yet ("coming soon"), so KHAN is listed here as a pre-launch project building trust in the open ahead of its public token launch.',
    // Disclosed on the record itself, not only in the site footer: whoever reads
    // this card is reading the operator's entry in the operator's own directory.
    riskNotes: 'KHAN Trust operates this directory and listed this entry itself. It was not submitted by a third party, was not auto-discovered, and has not passed the wallet-signature verification that other projects must complete.',
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
