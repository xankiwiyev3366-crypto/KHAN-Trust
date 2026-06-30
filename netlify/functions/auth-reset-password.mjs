import { consumeResetToken, getUserByEmail, updateUser, hashPassword, jsonResponse } from './_authStore.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { message: 'Invalid JSON' }); }

  const { token, password } = body;
  if (!token || !password) return jsonResponse(400, { message: 'Token and new password are required' });
  if (password.length < 8) return jsonResponse(400, { message: 'Password must be at least 8 characters' });

  const email = await consumeResetToken(token);
  if (!email) return jsonResponse(400, { message: 'Reset link is invalid or has expired' });

  const user = await getUserByEmail(email);
  if (!user) return jsonResponse(404, { message: 'User not found' });

  await updateUser(user.id, { passwordHash: hashPassword(password) });

  return jsonResponse(200, { message: 'Password has been reset successfully. You can now sign in.' });
}
