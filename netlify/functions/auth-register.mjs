import crypto from 'node:crypto';
import { getUserByEmail, saveUser, issueToken, createVerifyToken, hashPassword, jsonResponse } from './_authStore.mjs';
import { sendVerificationEmail } from './_email.mjs';
import { appendEvent } from './_analyticsStore.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });

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

  const { passwordHash, ...publicUser } = user;
  const token = issueToken(user);

  return jsonResponse(201, { user: publicUser, token });
}
