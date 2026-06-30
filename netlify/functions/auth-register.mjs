import crypto from 'node:crypto';
import { getUserByEmail, saveUser, issueToken, createVerifyToken, hashPassword, jsonResponse } from './_authStore.mjs';
import { appendEvent } from './_analyticsStore.mjs';

const APP_URL = process.env.URL || 'https://khantrust.net';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.SUPPORT_FROM_EMAIL || 'noreply@khantrust.net';

async function sendVerificationEmail(email, name, token) {
  if (!RESEND_API_KEY) return;
  const link = `${APP_URL}/#/verify-email/${token}`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: email,
      subject: 'Verify your KHAN Trust account',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#c9a227">KHAN Trust</h2>
        <p>Hi <strong>${name}</strong>,</p>
        <p>Click the button below to verify your email address and activate your account.</p>
        <p><a href="${link}" style="background:#c9a227;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold">Verify Email</a></p>
        <p style="color:#888;font-size:13px">This link expires in 24 hours. If you did not create an account, ignore this email.</p>
      </div>`,
    }),
  }).catch(() => {});
}

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
