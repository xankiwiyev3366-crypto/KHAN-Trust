// GET /.netlify/functions/referral-admin-list
// Admin-only. Every promoter (KOL / referrer) with their code, invite link, and
// full funnel counts, joined with the promoter's account name/email. Read-only;
// never mutates anything. Powers the Referral Analytics admin page.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { listRegisteredUsers, jsonResponse } from './_authStore.mjs';
import { listAllPromoters, buildReferralLink } from './_referralStore.mjs';

function originFrom(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  if (origin) return origin;
  const host = event.headers?.host || event.headers?.Host;
  if (host) {
    const proto = event.headers?.['x-forwarded-proto'] || 'https';
    return `${proto}://${host}`;
  }
  return null;
}

export async function handler(event) {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { message: 'Method not allowed' });
  if (!verifyToken(bearerToken(event))) return jsonResponse(401, { message: 'Unauthorized' });

  try {
    const siteOrigin = originFrom(event);
    const [promoters, users] = await Promise.all([
      listAllPromoters(),
      listRegisteredUsers(1000),
    ]);

    // id → account, built once, so joining promoters to names is O(n) not O(n²).
    const userById = new Map(users.map((u) => [u.id, u]));

    const rows = promoters.map((p) => {
      const u = userById.get(p.userId) || null;
      return {
        ...p,
        link: p.code ? buildReferralLink(p.code, siteOrigin) : null,
        name: u?.name || '',
        username: u?.username || '',
        email: u?.email || '',
      };
    });

    // Most productive promoters first (signups, then clicks), so the admin sees
    // the accounts that matter without sorting.
    rows.sort((a, b) => (b.signups - a.signups) || (b.clicks - a.clicks));

    // Platform-wide roll-up for the summary tiles.
    const totals = rows.reduce(
      (acc, r) => {
        acc.promoters += 1;
        acc.clicks += r.clicks;
        acc.signups += r.signups;
        acc.verified += r.verified;
        acc.active += r.active;
        acc.premium += r.premium;
        acc.lifetime += r.lifetime;
        return acc;
      },
      { promoters: 0, clicks: 0, signups: 0, verified: 0, active: 0, premium: 0, lifetime: 0 }
    );

    return jsonResponse(200, { generatedAt: new Date().toISOString(), totals, promoters: rows });
  } catch (error) {
    return jsonResponse(500, { message: `referral-admin-list crashed: ${error.message}` });
  }
}
