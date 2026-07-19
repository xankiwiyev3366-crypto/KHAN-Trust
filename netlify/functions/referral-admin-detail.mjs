// GET /.netlify/functions/referral-admin-detail?userId=<promoterId>
// Admin-only. One promoter's full referral history: every referred account with
// its funnel milestones, joined with the referred account's name/email. Read-
// only. Powers the "View detailed referral history" drill-down.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { getUserById, jsonResponse } from './_authStore.mjs';
import { getOwnerRecord, listReferralsForPromoter, foldEdges, conversionRate } from './_referralStore.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { message: 'Method not allowed' });
  if (!verifyToken(bearerToken(event))) return jsonResponse(401, { message: 'Unauthorized' });

  const userId = event.queryStringParameters?.userId;
  if (!userId) return jsonResponse(400, { message: 'userId is required' });

  try {
    const [owner, promoter, edges] = await Promise.all([
      getOwnerRecord(userId),
      getUserById(userId),
      listReferralsForPromoter(userId),
    ]);

    // Resolve each referred account's public fields for the history table.
    const referrals = await Promise.all(
      edges.map(async (edge) => {
        const u = await getUserById(edge.referredUserId).catch(() => null);
        return {
          referredUserId: edge.referredUserId,
          name: u?.name || '',
          email: u?.email || '',
          status: edge.status,
          registeredAt: edge.registeredAt || null,
          verifiedAt: edge.verifiedAt || null,
          activeAt: edge.activeAt || null,
          premiumAt: edge.premiumAt || null,
          lifetimeAt: edge.lifetimeAt || null,
        };
      })
    );

    // Newest signups first.
    referrals.sort((a, b) => Date.parse(b.registeredAt || 0) - Date.parse(a.registeredAt || 0));

    const stats = foldEdges(edges);
    stats.clicks = owner?.clicks || 0;

    return jsonResponse(200, {
      promoter: promoter
        ? { userId, name: promoter.name || '', email: promoter.email || '', username: promoter.username || '' }
        : { userId, name: '', email: '', username: '' },
      code: owner?.code || null,
      createdAt: owner?.createdAt || null,
      lastClickAt: owner?.lastClickAt || null,
      stats: {
        ...stats,
        signupConversion: conversionRate(stats.clicks, stats.signups),
        premiumRate: conversionRate(stats.signups, stats.premium),
      },
      referrals,
    });
  } catch (error) {
    return jsonResponse(500, { message: `referral-admin-detail crashed: ${error.message}` });
  }
}
