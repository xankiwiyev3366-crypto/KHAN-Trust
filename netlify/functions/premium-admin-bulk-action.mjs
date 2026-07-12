// POST /.netlify/functions/premium-admin-bulk-action
// Admin-only. Grants or removes MANUAL Premium for many registered users in a
// single operation, mirroring premium-admin-action.mjs but batched.
//
// Isolation guarantees (identical to the single-user endpoint):
//  - Only writes the manual-premium store (_premiumStore.mjs). It never reads
//    or writes the paid-entitlements store, Stripe, or payment records.
//  - The grants blob is read once and written once, so 100 users are updated
//    atomically from the client's point of view (one persisted write).
//  - Every bulk run appends one immutable audit entry with success/failed
//    counts; nothing is ever deleted.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { listRegisteredUsers, jsonResponse } from './_authStore.mjs';
import {
  readGrants, writeGrants, appendAudit, computeExpiry, effectivePlan,
  REASONS, SOURCES, DURATIONS,
} from './_premiumStore.mjs';

function sanitize(value, maxLength) {
  return String(value || '').replace(/<[^>]*>/g, '').trim().slice(0, maxLength);
}

// Bulk grants are always the plain "premium" plan for a fixed billing window;
// the four durations the admin panel offers map straight onto the shared
// computeExpiry() day-windows.
const BULK_DURATIONS = new Set(['30d', '90d', '180d', '365d']);

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

    const { action } = payload;
    if (!['bulk_grant', 'bulk_revoke'].includes(action)) {
      return jsonResponse(400, { message: 'Unknown bulk action.' });
    }

    const userIds = Array.isArray(payload.userIds)
      ? [...new Set(payload.userIds.filter((id) => typeof id === 'string' && id))]
      : [];
    if (!userIds.length) return jsonResponse(400, { message: 'Select at least one user.' });
    if (userIds.length > 1000) return jsonResponse(400, { message: 'Too many users in one operation (max 1000).' });

    const adminName = sanitize(payload.adminName, 120) || 'Administrator';
    const reason = REASONS.has(payload.reason) ? payload.reason : '';
    const source = SOURCES.has(payload.source) ? payload.source : 'manual';

    // Grants use a required fixed duration; revoke ignores duration entirely.
    let duration = null;
    if (action === 'bulk_grant') {
      duration = payload.duration;
      if (!BULK_DURATIONS.has(duration) || !DURATIONS.has(duration)) {
        return jsonResponse(400, { message: 'Invalid Premium duration.' });
      }
    }

    // Resolve every registered account once into an id -> user map so we can
    // validate each target without N round-trips per user.
    const registered = await listRegisteredUsers(2000);
    const usersById = new Map(registered.map((u) => [u.id, u]));

    const now = new Date();
    const nowIso = now.toISOString();
    // A single expiry timestamp for the whole batch keeps every user in this
    // run on the same clock.
    const expiresAt = action === 'bulk_grant' ? computeExpiry(duration) : null;

    const grants = await readGrants();
    const succeeded = [];
    const failed = [];

    for (const userId of userIds) {
      const user = usersById.get(userId);
      if (!user) {
        failed.push({ userId, error: 'not_found' });
        continue;
      }
      try {
        if (action === 'bulk_revoke') {
          const prev = grants[userId] || {};
          grants[userId] = {
            ...prev,
            plan: 'free',
            status: 'inactive',
            revokedAt: nowIso,
            revokedBy: adminName,
            updatedAt: nowIso,
          };
        } else {
          grants[userId] = {
            plan: 'premium',
            status: 'active',
            source,
            reason,
            duration,
            expiresAt,
            grantedBy: adminName,
            grantedAt: nowIso,
            updatedAt: nowIso,
          };
        }
        succeeded.push(userId);
      } catch {
        failed.push({ userId, error: 'update_failed' });
      }
    }

    // Only persist when at least one grant actually changed.
    if (succeeded.length) await writeGrants(grants);

    await appendAudit({
      id: `pab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'bulk',
      action,
      administrator: adminName,
      plan: action === 'bulk_grant' ? 'premium' : 'free',
      duration,
      reason,
      source: action === 'bulk_grant' ? source : null,
      userCount: userIds.length,
      successCount: succeeded.length,
      failedCount: failed.length,
      // Kept for compatibility with the single-action audit shape so the
      // shared audit table can still render a change summary.
      previousPlan: null,
      newPlan: action === 'bulk_grant' ? 'premium' : 'free',
      expiresAt,
      date: nowIso.slice(0, 10),
      time: nowIso.slice(11, 19),
      timestamp: nowIso,
    });

    return jsonResponse(200, {
      ok: true,
      action,
      duration,
      total: userIds.length,
      successCount: succeeded.length,
      failedCount: failed.length,
      effectivePlan: action === 'bulk_grant' ? effectivePlan(grants[succeeded[0]] || null) : 'free',
    });
  } catch (error) {
    return jsonResponse(500, { message: `premium-admin-bulk-action crashed: ${error.message}` });
  }
}
