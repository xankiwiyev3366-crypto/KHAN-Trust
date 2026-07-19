import { getUserByEmail, verifyPassword, issueToken, jsonResponse } from './_authStore.mjs';
import { appendEvent } from './_analyticsStore.mjs';
import { enforce, getClientIp } from './_rateLimit.mjs';
import { recordLogin } from './_growthRecord.mjs';
import { markMilestone } from './_referralStore.mjs';

function tooManyRequests(retryAfterMs) {
  return {
    statusCode: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(Math.ceil((retryAfterMs || 0) / 1000)),
    },
    body: JSON.stringify({ message: 'Too many attempts. Please wait a moment and try again.' }),
  };
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { message: 'Invalid JSON' }); }

  const { email, password } = body;
  if (!email || !password) return jsonResponse(400, { message: 'Email and password are required' });

  // Brute-force / credential-stuffing throttle: cap attempts per source IP and
  // per targeted email before doing any (deliberately slow) password hashing.
  const ip = getClientIp(event);
  const ipLimit = await enforce('login_ip', ip);
  if (!ipLimit.allowed) return tooManyRequests(ipLimit.retryAfterMs);
  const emailLimit = await enforce('login_email', String(email).toLowerCase().trim());
  if (!emailLimit.allowed) return tooManyRequests(emailLimit.retryAfterMs);

  const user = await getUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return jsonResponse(401, { message: 'Invalid email or password' });
  }

  await appendEvent({
    type: 'user_login',
    userId: user.id,
    timestamp: new Date().toISOString(),
  }).catch(() => {});

  // Growth Data Plane. Server-side so logins cannot be forged - the return-visit
  // record that D1/D7/D30 retention is computed from.
  await recordLogin({
    userId: user.id,
    attribution: body.attribution,
    device: body.device,
  });

  // Referral funnel: a returning sign-in is the clearest "active user" signal we
  // have server-side (registration auto-issues a token without a login call, so
  // this only fires on a genuine return). Idempotent; a no-op for non-referred
  // users and after the first time.
  await markMilestone(user.id, 'active').catch(() => {});

  const { passwordHash, ...publicUser } = user;
  const token = issueToken(user);

  return jsonResponse(200, { user: publicUser, token });
}
