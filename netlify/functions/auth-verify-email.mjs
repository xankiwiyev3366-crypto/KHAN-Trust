import { consumeVerifyToken, getUserByEmail, updateUser, issueToken, recordSuccessfulAuth, AUTH_METHOD, jsonResponse } from './_authStore.mjs';
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

  // Consuming a single-use emailed token and being handed a session token is a
  // successful authentication, so it counts as a login. Recorded only after
  // consumeVerifyToken() succeeded above — an invalid or expired link returns
  // early and writes nothing.
  //
  // Note: email verification ALONE is not evidence of a login (see the
  // migration note in _loginBackfill.mjs — `emailVerified` is deliberately not
  // used as backfill evidence). It counts here because this specific flow also
  // issues a session token; a user who verified through some path that did not
  // sign them in would not reach this line.
  await recordSuccessfulAuth(user.id, { method: AUTH_METHOD.EMAIL_VERIFY });

  const { passwordHash, ...publicUser } = updated;

  return jsonResponse(200, { user: publicUser, token: issueToken(updated) });
}
