import crypto from 'node:crypto';
import { getUserByEmail, saveUser, issueToken, createVerifyToken, hashPassword, recordSuccessfulAuth, AUTH_METHOD, jsonResponse } from './_authStore.mjs';
import { sendVerificationEmail } from './_email.mjs';
import { appendEvent } from './_analyticsStore.mjs';
import { enforce, getClientIp } from './_rateLimit.mjs';
import { recordRegistration } from './_growthRecord.mjs';
import { attachReferral } from './_referralStore.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });

  // Throttle mass account creation from a single source.
  const ipLimit = await enforce('register_ip', getClientIp(event));
  if (!ipLimit.allowed) {
    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil((ipLimit.retryAfterMs || 0) / 1000)) },
      body: JSON.stringify({ message: 'Too many sign-up attempts. Please try again later.' }),
    };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { message: 'Invalid JSON' }); }

  const { name, email, password } = body;
  if (!name?.trim()) return jsonResponse(400, { message: 'Name is required' });
  if (!email?.trim()) return jsonResponse(400, { message: 'Email is required' });
  if (!password) return jsonResponse(400, { message: 'Password is required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse(400, { message: 'Invalid email address' });
  if (password.length < 8) return jsonResponse(400, { message: 'Password must be at least 8 characters' });

  const existing = await getUserByEmail(email);
  if (existing) return jsonResponse(409, { message: 'An account with this email already exists' });

  const id = `u-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const user = {
    id,
    name: name.trim(),
    email: email.toLowerCase().trim(),
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
    emailVerified: false,
    avatarUrl: null,
  };

  await saveUser(user);

  const verifyToken = await createVerifyToken(user.email);
  const emailResult = await sendVerificationEmail(user.email, user.name, verifyToken);
  if (!emailResult.ok) {
    // Registration must still succeed even if the welcome email fails to
    // send (the user can always use Resend from their profile) - but the
    // failure needs to be visible somewhere, otherwise every affected
    // signup silently ends up permanently unverified with no clue why.
    console.error('[auth-register] verification email failed to send', {
      userId: id,
      reason: emailResult.reason,
      status: emailResult.status,
      detail: emailResult.detail,
    });
  }

  await appendEvent({
    type: 'user_registered',
    userId: id,
    timestamp: new Date().toISOString(),
  }).catch(() => {});

  // Growth Data Plane. Recorded server-side (never via the public ingestion
  // endpoint) so a registration cannot be forged with a curl.
  //
  // `attribution` is forwarded by the client from its stored first-touch: this
  // is the exact moment an anonymous visitor becomes an account, so it is the
  // only point where the channel that ORIGINALLY brought them here can be
  // welded to a real user id. Miss it and the question "which video acquires
  // users" becomes permanently unanswerable for this signup.
  await recordRegistration({
    userId: id,
    attribution: body.attribution,
    device: body.device,
  });

  // Referral & Invite System: bind this new account to its inviter, if it
  // arrived through a referral link (`referralCode` is the code the client
  // captured from ?ref= at first touch). Every guard inside attachReferral is a
  // silent no-op — self-referral, an unknown code, an already-referred user, a
  // loop — so a referral can never block or fail a sign-up. Fully isolated:
  // failure here must not affect account creation.
  await attachReferral({ referredUserId: id, code: body.referralCode }).catch(() => {});

  const { passwordHash, ...publicUser } = user;
  const token = issueToken(user);

  // Registration AUTO-LOGS-IN: a token is issued here and the user lands
  // signed in without ever calling auth-login. That is a genuine successful
  // authentication and was previously recorded nowhere, so a user who
  // registered and simply stayed signed in showed as "Never Logged In"
  // forever. This was the single largest contributor to that count.
  await recordSuccessfulAuth(id, { method: AUTH_METHOD.REGISTRATION });

  return jsonResponse(201, { user: publicUser, token });
}
