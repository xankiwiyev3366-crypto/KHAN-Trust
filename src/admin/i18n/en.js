// Console copy — English (the default and the source of truth).
//
// Deliberately SEPARATE from src/i18n/, which belongs to the user app. Reusing
// that would put console strings ("Executive Brief", "Growth OS") into the
// dictionary shipped to every visitor and break the privacy boundary — the
// build check in scripts/verify-boundary.mjs greps for exactly those strings.
//
// az.js mirrors this shape key-for-key; src/admin/i18n/i18n.test.mjs fails the
// suite if the two ever drift apart.
export default {
  brand: {
    name: 'Growth OS',
    site: 'KHAN Trust',
  },

  login: {
    eyebrow: 'Restricted',
    title: 'Console',
    passcode: 'Passcode',
    signIn: 'Sign in',
    checking: 'Checking…',
    failed: 'Sign-in failed.',
  },

  nav: {
    overview: 'Executive Brief',
    funnel: 'Funnel',
    retention: 'Retention',
    acquisition: 'Acquisition',
    content: 'Content Engine',
    initiatives: 'Initiatives',
    signOut: 'Sign out',
    language: 'Language',
  },

  common: {
    loading: 'Loading…',
    couldNotLoad: 'Could not load',
    noData: 'No data',
    reload: 'Reload',
    visitors: 'visitors',
    eyebrow: 'Growth OS',
    // A metric that was never measured. Must never render as "0%".
    notMeasured: '—',
  },

  confidence: {
    sufficient: 'Reliable',
    directional: 'Directional',
    insufficient: 'Not enough data',
    canWeTrust: 'Can we trust it?',
  },

  errors: {
    pageCrashed: 'This page hit an error',
    restWorks: 'The rest of the console still works — use the sidebar to move to another module.',
  },

  overview: {
    title: 'Executive brief',
    aiSpend: 'AI spend this month',
    ofCap: 'of {cap} cap',
    budgetUsed: 'Budget used',
    calls: '{count} calls',
    remaining: 'Remaining',
    hardCap: 'hard cap — calls refuse past it',
    eventsRecorded: 'Events recorded',
    lastDays: 'last {days} days',
    aiOffTitle: 'The analyst layer is switched off.',
    aiOffBody: 'ANTHROPIC_API_KEY is not set. Everything else in this console is fully deterministic and needs no AI — the funnel, retention, attribution and content-demand pages all work exactly as they do with it enabled.',
    dataHealth: 'Data health',
    runNow: 'Run analysis now',
    running: 'Running the team…',
    runHint: 'Runs automatically every Monday. A manual run costs roughly a cent.',
    progressStarting: 'Starting the team…',
    progressWorking: 'Analysts are working. This usually takes under a minute…',
    pollTimeout: 'No report appeared within 4 minutes. The run may still be in progress — reload shortly. If nothing shows up, check the growth-analyze-background function logs in Netlify.',
    // Shown when a stored report's prose is in a language other than the one
    // the console is currently displaying. Reports are immutable — the honest
    // move is to say so, not to silently show English under an Azerbaijani UI.
    langMismatch: 'This report was written in {reportLang}. Reports are not re-translated — run the analysis again to get one in {currentLang}.',
    langEn: 'English',
    langAz: 'Azerbaijani',
    noBriefTitle: 'No brief yet',
    noBriefBody: 'The team has not run. It will run automatically on Monday, or you can trigger it above. With an empty event log it will correctly report that it has nothing to work from rather than inventing a strategy.',
    generatedAt: 'Generated {at} · {trigger} · {days}-day window',
    triggerManual: 'manual',
    triggerScheduled: 'scheduled',
    noSynthesisTitle: 'No synthesis',
    noSynthesisBody: 'The Chief of Staff did not complete; the individual analyst reports below still stand on their own.',
    analystReports: 'Individual analyst reports',
    someFailed: 'Some analysts failed on this run.',
    unknownsTitle: 'What the team could not know',
    unknownsIntro: 'These were withheld from the analysts because the data cannot support a conclusion. They are the highest-value things to go and make measurable.',
  },

  // Server-generated explanations, rendered from a code + params the warehouse
  // emits alongside its English prose. Without these the operator would read an
  // Azerbaijani heading over an English paragraph.
  reasons: {
    fabricated_numbers: 'Dropped: cites {numbers}, which do not appear in the source metrics. Treated as fabricated.',
    below_min_sample: 'Only {n} observations — below the {min} needed before a rate means anything. Not enough data to act on.',
    interval_tight: 'n={n}. True value is very likely within {range}. Reliable enough to decide on.',
    interval_wide: 'n={n}. True value is somewhere in {range} — wide, so treat the direction as real but the exact figure as provisional.',
    interval_too_wide: 'n={n}. The true value could be anywhere in {range} — too wide to support any conclusion.',
    count_too_few: 'Only {n} recorded — too few to read a pattern into.',
    count_rough: '{n} recorded — enough to see a rough shape, not enough to be precise.',
    count_fine: '{n} recorded.',
    change_insufficient: 'One or both periods have too little data to compare. Any percentage change between them is noise.',
    change_separated: 'The two periods’ confidence intervals do not overlap — this change is real, not noise.',
    change_overlapping: 'The two periods’ confidence intervals overlap — this apparent change is consistent with random variation.',
    instrumentation_gap: 'Not one of the {upstreamCount} visitors who reached “{upstreamStage}” registered a “{stage}” event. That is either a total funnel collapse at this step or the event is not being tracked. Verify instrumentation before treating it as a growth problem.',
    bottleneck_found: '“{stage}” converts at the lowest rate of any step with usable data ({percent}%).',
    bottleneck_insufficient: 'No funnel step has enough data to identify a bottleneck yet. More traffic is required before this question is answerable.',
    bottleneck_blocked_by_gaps: 'No funnel step can be ranked yet: the steps with enough traffic to judge have no events recorded at all, which points at missing instrumentation rather than a growth problem.',
    retention_matured_only: 'Only cohorts whose horizon has fully elapsed are counted, so recent signups never appear as retention failures.',
    retention_no_signups: 'Cohort retention needs registrations inside the window, and enough elapsed time for each horizon to have matured.',
    data_plane_thin: 'The Growth Data Plane is newly deployed and this window is thin. Most rates will read “insufficient” until traffic accumulates — that is correct behaviour, not a bug.',
    hit_rate_too_few: 'Only {n} initiative(s) measured so far — far too few to judge the system’s advice. This becomes meaningful after a dozen or so.',
  },

  roles: {
    content_strategist: 'Acquisition & Content Strategist',
    growth_analyst: 'Growth Analyst',
    product_analyst: 'Product & UX Analyst',
    executive_brief: 'Chief of Staff',
  },

  funnel: {
    stages: {
      visited: 'Visited',
      activated: 'Scanned a token',
      registered: 'Registered',
      pricing: 'Viewed pricing',
      checkout: 'Started checkout',
      converted: 'Paid',
    },
    title: 'Conversion funnel',
    intro: 'Measured in visitors, not events — one person scanning forty tokens is one activated visitor, not forty. Every rate carries its statistical standing; a rate marked “Not enough data” is not a small number, it is an unknown one.',
    introStrong: 'visitors, not events',
    trackingGap: 'Possible tracking gap — read this first.',
    events: 'events (wallet-keyed, not people)',
    stepConversion: 'Step-to-step conversion',
    colStep: 'Step',
    colReached: 'Reached',
    colConversion: 'Conversion',
    noSteps: 'No funnel steps recorded yet.',
    bottleneck: 'Bottleneck',
    notAnswerable: 'Not answerable yet',
    blockers: 'Why checkouts failed',
    blockersIntro: 'Recorded first-party with the reason attached. wallet_required is product friction you can fix; missing_config means checkout is broken and revenue is being lost silently. Google Analytics cannot tell these two apart.',
    colReason: 'Reason',
    colCount: 'Count',
    noBlockers: 'No failed checkouts recorded in this window.',
  },

  retention: {
    title: 'Cohort retention',
    intro: 'Real cohort retention: users are grouped by the day they registered, then measured on whether they came back on day 1, 7 and 30. This is not the old “returning users” number, which counted anyone who ever logged in on two different days — that figure has no time dimension, can only ever go up, and cannot reveal that retention is getting worse.',
    calloutTitle: 'Users whose horizon has not elapsed are excluded, not counted as churned.',
    calloutBody: 'Someone who signed up two days ago has not failed D7 — their D7 has not happened yet. Counting them as a failure is the most common way retention dashboards understate reality.',
    horizon: '{horizon} retention',
    ofUsers: '{retained}/{eligible} users',
    notEnough: 'not enough data',
    byCohort: 'By signup cohort',
    colSignupDay: 'Signup day',
    colUsers: 'Users',
    notDue: 'not yet due',
  },

  acquisition: {
    title: 'Acquisition by channel',
    intro: 'Attributed on first touch, not last. Someone who found KHAN Trust through a TikTok, left, and came back later by typing the URL is a TikTok acquisition — last-touch would file them under “Direct” and you would conclude, wrongly, that TikTok does not work.',
    calloutTitle: 'This page could not exist before the Growth Data Plane shipped.',
    calloutBody: 'The old traffic detector recognised five sources: direct, Google, X, Telegram and “other”. YouTube and TikTok — the only two channels you market on — both landed in “other”. Their performance was not merely unmeasured; it was unmeasurable.',
    noOwnedTitle: 'No YouTube or TikTok traffic recorded yet',
    noOwnedBody: 'Tag your links with ?utm_source=youtube or ?utm_source=tiktok. UTM tags matter more than you\'d expect: both platforms strip the referrer on most in-app taps, so untagged traffic from them arrives looking like Direct.',
    allChannels: 'All channels',
    colChannel: 'Channel',
    colVisitors: 'Visitors',
    colSignups: 'Signups',
    colSignupRate: 'Signup rate',
    noTraffic: 'No attributed traffic recorded yet. The data plane only started collecting when it was deployed — earlier visits cannot be backfilled.',
  },

  channels: {
    youtube: 'YouTube',
    tiktok: 'TikTok',
    google: 'Google',
    direct: 'Direct',
    referral: 'Other referral',
    x: 'X',
    telegram: 'Telegram',
    reddit: 'Reddit',
    internal: 'Internal',
  },

  content: {
    title: 'Content engine',
    intro: 'Your scan log is a content-demand signal nobody else has. Every scan is a real person telling you, unprompted, which token they are worried enough to check — a direct readout of what crypto users are anxious about this week. The tokens people already search for are the videos that already have an audience.',
    calloutTitle: 'Demand is recency-weighted (7-day half-life).',
    calloutBody: 'Crypto attention decays in days, so a token scanned 30 times last month ranks below one scanned 8 times this week. A heavily-scanned token that scored low on trust is the strongest hook you have: real demand, a real warning, and a natural demonstration of what the product does.',
    whatScanning: 'What people are scanning',
    colToken: 'Token',
    colTicker: 'Ticker',
    colDemand: 'Demand',
    colScans: 'Scans',
    colPeople: 'People',
    colTrustScore: 'Trust score you gave it',
    colLastScanned: 'Last scanned',
    colSignal: 'Signal strength',
    noScans: 'No scans recorded in this window yet. This table fills as real users scan tokens — it cannot be backfilled from before the data plane shipped.',
    strategist: 'Content strategist',
    noPlanTitle: 'No content plan yet',
    noPlanBody: 'The analyst team runs every Monday, or on demand from the Executive Brief page. It needs scan data to be specific — with an empty scan log it will correctly tell you it has nothing to work from.',
    openQuestions: 'What would make the next plan better',
  },

  initiatives: {
    title: 'Initiatives',
    intro: 'This is what makes the system an executive team rather than an idea generator: every recommendation you accept is tracked through to a measured outcome, so the team learns whether its own advice was any good.',
    calloutTitle: 'Accepting an initiative snapshots your current metrics.',
    calloutBody: 'That baseline is captured at accept time and can never be reconstructed afterwards — it is the only thing that makes “did this work?” answerable later, once the metric has moved for a dozen unrelated reasons.',
    tracked: 'Tracked',
    inFlight: 'In flight',
    measured: 'Measured',
    hitRate: 'Hit rate',
    nothingMeasured: 'nothing measured yet',
    ofMeasured: 'of measured initiatives',
    nothingTrackedTitle: 'Nothing tracked yet',
    nothingTrackedBody: 'Accept a recommendation from the Executive Brief or Content Engine to start tracking it here.',
    proposedBy: 'Proposed',
    proposedByLine: '{at} by {who}',
    you: 'you',
    baselineAtAccept: 'Baseline at accept',
    baselineLine: '{visitors} visitors · captured {at}',
    outcome: 'Outcome',
    measurePlaceholder: 'What actually happened? Be honest — “inconclusive” is usually the correct answer at this scale, and recording it as a win teaches the system the wrong lesson.',
  },

  status: {
    proposed: 'proposed',
    accepted: 'accepted',
    shipped: 'shipped',
    measured: 'measured',
    rejected: 'rejected',
  },

  actions: {
    accept: 'Accept',
    reject: 'Reject',
    markShipped: 'Mark shipped',
    drop: 'Drop',
    recordOutcome: 'Record outcome',
  },

  outcomes: {
    worked: 'It worked',
    no_effect: 'No effect',
    inconclusive: 'Inconclusive',
    backfired: 'It backfired',
  },

  rec: {
    why: 'Why',
    expectedImpact: 'Expected impact',
    roi: 'ROI',
    risks: 'Risks',
    complexity: '{level} complexity',
    trackAsInitiative: 'Track as initiative',
    adding: 'Adding…',
    dataVerdictTitle: 'What the data can actually support',
    fabricationTitle: '{count} recommendation(s) were dropped for citing invented numbers.',
    fabricationBody: 'These cited figures that do not appear anywhere in the source metrics, so they were removed automatically before reaching this page. Shown here because a model that fabricates is worth knowing about.',
  },

  recConfidence: {
    grounded_in_data: 'Grounded in data',
    informed_judgement: 'Informed judgement',
    speculative: 'Speculative',
  },

  complexity: {
    low: 'low',
    medium: 'medium',
    high: 'high',
  },

  objectives: {
    registrations: 'Registrations',
    active_users: 'Active users',
    retention: 'Retention',
    user_experience: 'UX',
    conversion: 'Conversion',
    trust: 'Trust',
    brand_awareness: 'Brand awareness',
    positioning: 'Positioning',
    new_opportunity: 'New opportunity',
    investor_readiness: 'Investor readiness',
    data_quality: 'Data quality',
  },
};
