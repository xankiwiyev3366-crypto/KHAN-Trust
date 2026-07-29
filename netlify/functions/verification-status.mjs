import { readStatuses, jsonResponse } from './_verificationStore.mjs';
import { isVerificationActive } from '../../src/lib/verificationTiers.js';

// Public endpoint - returns the single source of truth verification status
// map ({ [projectId]: { status, updatedAt, adminNote } }) consumed by
// Explore, Project Profile, Compare, and the PDF report.
//
// EXPIRY IS APPLIED ON READ, NOT BY A SWEEPER.
//
// Paid verification is time-bounded (src/lib/verificationTiers.js). The obvious
// implementation is a scheduled job that rewrites lapsed records to
// 'unverified' — and it is the wrong one, because between the moment a badge
// expires and the moment that job next runs, every surface on this platform
// keeps asserting a verification that has ended. This one map feeds Explore,
// the project profile, Compare, the PDF report and the badge, so a stale window
// here is a stale window everywhere at once.
//
// Deriving it from the timestamp means the answer is correct the instant it
// lapses, with no job to fail, and it stays correct if a job is ever added.
//
// A record with NO expiresAt is permanent, which is what every admin-approved
// verification predating this system looks like. Retroactively expiring those
// because a paid product shipped would revoke something already granted, so
// isVerificationActive() treats a missing expiry as unlimited on purpose.
export function applyExpiry(statuses, now = Date.now()) {
  const out = {};
  for (const [projectId, record] of Object.entries(statuses || {})) {
    if (record?.status !== 'verified' || isVerificationActive(record, now)) {
      out[projectId] = record;
      continue;
    }
    // Lapsed. Reported as 'expired' rather than 'unverified' so the difference
    // between "was never verified" and "was verified and the term ran out" is
    // not thrown away — the owner sees a renewal prompt instead of being told
    // their verification never existed. Consumers that test for === 'verified'
    // correctly stop showing the badge either way.
    out[projectId] = { ...record, status: 'expired', expiredAt: record.expiresAt || '' };
  }
  return out;
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    const statuses = await readStatuses();
    return jsonResponse(200, { statuses: applyExpiry(statuses) });
  } catch (error) {
    return jsonResponse(500, { message: `verification-status crashed: ${error.message}` });
  }
}
