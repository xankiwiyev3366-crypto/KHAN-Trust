import { verifyJwt, getUserById, updateUser, bearerToken, jsonResponse } from './_authStore.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'PUT') return jsonResponse(405, { message: 'Method not allowed' });

  const payload = verifyJwt(bearerToken(event));
  if (!payload) return jsonResponse(401, { message: 'Unauthorized' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { message: 'Invalid JSON' }); }

  const updates = {};
  if (body.name?.trim()) updates.name = body.name.trim();
  if (body.avatarUrl !== undefined) updates.avatarUrl = body.avatarUrl || null;

  if (!Object.keys(updates).length) return jsonResponse(400, { message: 'No valid fields to update' });

  const updated = await updateUser(payload.sub, updates);
  if (!updated) return jsonResponse(404, { message: 'User not found' });

  const { passwordHash, ...publicUser } = updated;
  return jsonResponse(200, { user: publicUser });
}
