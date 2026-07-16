// The Growth Loop — the difference between an executive team and a brainstorm.
//
// An AI that emits recommendations and never learns whether they worked is an
// expensive idea generator. This module closes the loop: a recommendation the
// founder accepts becomes a tracked Initiative that moves
// proposed -> accepted -> shipped -> measured, and the outcome is recorded.
//
// The single most important field here is `baseline`.
//
// It captures the relevant metrics AT THE MOMENT THE INITIATIVE IS ACCEPTED,
// before any work happens. Without it, "did this work?" is unanswerable after
// the fact: memory rewrites itself, the metric has moved for a dozen reasons,
// and the honest comparison is gone forever. Snapshotting is the only moment
// the baseline can be captured, and it cannot be reconstructed later at any
// price. This is why accepting an initiative reads the warehouse.
//
// Each initiative is its own blob key - append-only, no read-modify-write.
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-growth-initiatives';
const PREFIX = 'initiatives/';

export const STATUS = {
  PROPOSED: 'proposed',
  ACCEPTED: 'accepted',
  SHIPPED: 'shipped',
  MEASURED: 'measured',
  REJECTED: 'rejected',
};

// The honest set of outcomes. `inconclusive` is not a cop-out — at this scale
// it is the CORRECT answer most of the time, and a system that forces every
// result into worked/failed would be manufacturing exactly the false certainty
// the Confidence Engine exists to prevent.
export const OUTCOME = {
  WORKED: 'worked',
  NO_EFFECT: 'no_effect',
  INCONCLUSIVE: 'inconclusive',
  BACKFIRED: 'backfired',
};

const VALID_TRANSITIONS = {
  [STATUS.PROPOSED]: [STATUS.ACCEPTED, STATUS.REJECTED],
  [STATUS.ACCEPTED]: [STATUS.SHIPPED, STATUS.REJECTED],
  [STATUS.SHIPPED]: [STATUS.MEASURED],
  [STATUS.MEASURED]: [],
  [STATUS.REJECTED]: [],
};

export function canTransition(from, to) {
  return (VALID_TRANSITIONS[from] || []).includes(to);
}

function store() {
  return getNamedStore(STORE_NAME);
}

// Reduces a warehouse to the handful of numbers worth comparing against later.
// Deliberately small: a full warehouse snapshot per initiative would be large,
// mostly irrelevant, and would obscure the comparison it exists to enable.
export function snapshotBaseline(warehouse) {
  return {
    at: new Date().toISOString(),
    totalVisitors: warehouse.funnel.totalVisitors,
    stages: warehouse.funnel.stages.map((stage) => ({
      id: stage.id,
      count: stage.count,
      rate: stage.rate?.value ?? null,
      confidence: stage.rate?.confidence?.level ?? null,
    })),
    channels: warehouse.channels.map((row) => ({
      channel: row.channel,
      visitors: row.visitors,
      signups: row.signups,
    })),
    retention: {
      d1: warehouse.retention.summary.d1.value,
      d7: warehouse.retention.summary.d7.value,
      d30: warehouse.retention.summary.d30.value,
    },
  };
}

export async function createInitiative({ recommendation, sourceReportId, sourceRole }) {
  const id = `init-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const initiative = {
    id,
    status: STATUS.PROPOSED,
    createdAt: new Date().toISOString(),
    recommendation,
    sourceReportId: sourceReportId || null,
    sourceRole: sourceRole || null,
    baseline: null,
    shippedAt: null,
    measuredAt: null,
    outcome: null,
    outcomeNote: null,
    history: [{ at: new Date().toISOString(), status: STATUS.PROPOSED }],
  };
  await store().setJSON(`${PREFIX}${id}`, initiative);
  return initiative;
}

export async function getInitiative(id) {
  return store().get(`${PREFIX}${id}`, { type: 'json' }).catch(() => null);
}

export async function listInitiatives() {
  const { blobs } = await store().list({ prefix: PREFIX });
  const items = await Promise.all(
    blobs.map((blob) => store().get(blob.key, { type: 'json' }).catch(() => null))
  );
  return items.filter(Boolean).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// Advances an initiative. Rejects illegal transitions rather than silently
// coercing them: an initiative that jumps proposed -> measured has no baseline,
// so its "result" would be meaningless, and a meaningless result recorded as
// fact is worse than no result.
export async function updateInitiative(id, { status, outcome, outcomeNote, baseline }) {
  const initiative = await getInitiative(id);
  if (!initiative) throw Object.assign(new Error('Initiative not found'), { code: 'NOT_FOUND' });

  if (status && status !== initiative.status) {
    if (!canTransition(initiative.status, status)) {
      throw Object.assign(
        new Error(`Cannot move an initiative from "${initiative.status}" to "${status}".`),
        { code: 'INVALID_TRANSITION' }
      );
    }
    initiative.status = status;
    initiative.history.push({ at: new Date().toISOString(), status });

    if (status === STATUS.ACCEPTED && baseline) initiative.baseline = baseline;
    if (status === STATUS.SHIPPED) initiative.shippedAt = new Date().toISOString();
    if (status === STATUS.MEASURED) initiative.measuredAt = new Date().toISOString();
  }

  if (outcome) {
    if (!Object.values(OUTCOME).includes(outcome)) {
      throw Object.assign(new Error(`Unknown outcome "${outcome}"`), { code: 'INVALID_OUTCOME' });
    }
    initiative.outcome = outcome;
  }
  if (outcomeNote !== undefined) initiative.outcomeNote = outcomeNote;

  await store().setJSON(`${PREFIX}${id}`, initiative);
  return initiative;
}

// What the loop has actually taught the operation. This is the payoff: after a
// few months it answers "is this system's advice any good?" with a record
// rather than a feeling.
export function summarise(initiatives) {
  const byStatus = {};
  for (const status of Object.values(STATUS)) {
    byStatus[status] = initiatives.filter((item) => item.status === status).length;
  }

  const measured = initiatives.filter((item) => item.status === STATUS.MEASURED && item.outcome);
  const byOutcome = {};
  for (const outcome of Object.values(OUTCOME)) {
    byOutcome[outcome] = measured.filter((item) => item.outcome === outcome).length;
  }

  return {
    total: initiatives.length,
    byStatus,
    byOutcome,
    measuredCount: measured.length,
    // Explicitly null rather than 0 until there is anything to judge - the same
    // "absence is not zero" rule the warehouse follows.
    hitRate: measured.length
      ? Math.round((byOutcome[OUTCOME.WORKED] / measured.length) * 100) / 100
      : null,
    hitRateNote: measured.length < 5
      ? `Only ${measured.length} initiative(s) measured so far — far too few to judge the system's advice. This becomes meaningful after a dozen or so.`
      : null,
    hitRateNoteCode: measured.length < 5 ? 'hit_rate_too_few' : null,
    hitRateNoteParams: { n: measured.length },
  };
}

export { jsonResponse };
