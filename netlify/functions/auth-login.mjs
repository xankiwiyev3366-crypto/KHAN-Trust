import { getUserByEmail, verifyPassword, issueToken, jsonResponse } from './_authStore.mjs';
import { appendEvent } from './_analyticsStore.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { message: 'Invalid JSON' }); }

  const { email, password } = body;
  if (!email || !password) return jsonResponse(400, { message: 'Email and password are required' });

  const user = await getUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return jsonResponse(401, { message: 'Invalid email or password' });
  }

  await appendEvent({
    type: 'user_login',
    userId: user.id,
    timestamp: new Date().toISOString(),
  }).catch(() => {});

  const { passwordHash, ...publicUser } = user;
  const token = issueToken(user);

  return jsonResponse(200, { user: publicUser, token });
}
