import { consumeVerifyToken, getUserByEmail, updateUser, issueToken, jsonResponse } from './_authStore.mjs';
import { markMilestone } from './_referralStore.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { message: 'Invalid JSON' }); }

  const { token } = body;
  if (!token) return jsonResponse(400, { message: 'Verification token is required' });

  const email = await consumeVerifyToken(token);
  if (!email) return jsonResponse(400, { message: 'Verification link is invalid or has expired' });

  const user = await getUserByEmail(email);
  if (!user) return jsonResponse(404, { message: 'User not found' });

  const updated = await updateUser(user.id, { emailVerified: true });

  // Referral funnel: advance this account's edge to "verified" if it was
  // referred. Idempotent and best-effort — a no-op for non-referred users.
  await markMilestone(user.id, 'verified').catch(() => {});

  const { passwordHash, ...publicUser } = updated;

  return jsonResponse(200, { user: publicUser, token: issueToken(updated) });
}
