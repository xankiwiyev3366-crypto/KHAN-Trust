// POST /.netlify/functions/premium-admin-action
// Every admin mutation on a user's MANUAL Premium goes through this one
// endpoint with an `action` field (grant | change_plan | revoke), mirroring
// report-admin-action.mjs / support-admin-action.mjs.
//
// Isolation guarantees (see task spec):
//  - Only writes the manual-premium store (_premiumStore.mjs). It never reads
//    or writes the paid-entitlements store, Stripe, or payment records.
//  - Every action appends an immutable audit entry; nothing is ever deleted.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { getUserById, jsonResponse } from './_authStore.mjs';
import {
  getGrant, setGrant, appendAudit, computeExpiry, effectivePlan,
  PLANS, SOURCES, REASONS, DURATIONS,
} from './_premiumStore.mjs';

function sanitize(value, maxLength) {
  return String(value || '').replace(/<[^>]*>/g, '').trim().slice(0, maxLength);
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });
    if (!verifyToken(bearerToken(event))) return jsonResponse(401, { message: 'Unauthorized' });

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { message: 'Invalid request body' });
    }

    const { action, userId } = payload;
    if (!['grant', 'change_plan', 'revoke'].includes(action)) {
      return jsonResponse(400, { message: 'Unknown action.' });
    }
    if (!userId) return jsonResponse(400, { message: 'userId is required.' });

    // The target must be an already-registered user - this module never
    // creates accounts, it only augments existing ones.
    const user = await getUserById(userId);
    if (!user) return jsonResponse(404, { message: 'Registered user not found.' });

    const prevGrant = await getGrant(userId);
    const previousPlan = effectivePlan(prevGrant);

    const adminName = sanitize(payload.adminName, 120) || 'Administrator';
    const reason = REASONS.has(payload.reason) ? payload.reason : '';
    const now = new Date();
    const nowIso = now.toISOString();

    let record;
    let newPlan;

    if (action === 'revoke') {
      // Keep the record (for source/history visibility) but mark it inactive
      // and drop the user back to Free. Never deletes the grant or the audit.
      newPlan = 'free';
      record = {
        ...(prevGrant || {}),
        plan: 'free',
        status: 'inactive',
        revokedAt: nowIso,
        revokedBy: adminName,
        updatedAt: nowIso,
      };
    } else {
      // grant defaults to premium; change_plan uses the supplied plan (which
      // may be 'free', 'premium' or 'early_supporter').
      const requestedPlan = action === 'grant' ? (payload.plan || 'premium') : payload.plan;
      if (!PLANS.has(requestedPlan)) return jsonResponse(400, { message: 'Invalid plan.' });

      const source = SOURCES.has(payload.source) ? payload.source : 'manual';
      const duration = DURATIONS.has(payload.duration) ? payload.duration : 'lifetime';
      const expiresAt = requestedPlan === 'free' ? null : computeExpiry(duration, payload.customExpiry);

      newPlan = requestedPlan;
      record = {
        plan: requestedPlan,
        status: requestedPlan === 'free' ? 'inactive' : 'active',
        source,
        reason,
        duration,
        expiresAt,
        grantedBy: adminName,
        grantedAt: nowIso,
        updatedAt: nowIso,
      };
    }

    await setGrant(userId, record);

    await appendAudit({
      id: `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action,
      administrator: adminName,
      userId,
      userEmail: user.email,
      userName: user.name || '',
      previousPlan,
      newPlan,
      reason,
      source: record.source || null,
      expiresAt: record.expiresAt ?? null,
      date: nowIso.slice(0, 10),
      time: nowIso.slice(11, 19),
      timestamp: nowIso,
    });

    return jsonResponse(200, {
      ok: true,
      userId,
      grant: record,
      effectivePlan: effectivePlan(record),
    });
  } catch (error) {
    return jsonResponse(500, { message: `premium-admin-action crashed: ${error.message}` });
  }
}
