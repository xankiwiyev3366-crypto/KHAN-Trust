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
  await sendVerificationEmail(user.email, user.name, verifyToken);

  await appendEvent({
    type: 'user_registered',
    userId: id,
    timestamp: new Date().toISOString(),
  }).catch(() => {});

  const { passwordHash, ...publicUser } = user;
  const token = issueToken(user);

  return jsonResponse(201, { user: publicUser, token });
}
