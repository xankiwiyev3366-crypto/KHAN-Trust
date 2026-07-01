import { verifyJwt, getUserById, updateUser, bearerToken, jsonResponse } from './_authStore.mjs';

// Avatars are stored inline as data: URLs on the user record (see
// updateUser) rather than in a separate blob store or CDN - simplest option
// that reuses the existing per-user JSON record, and small enough once
// resized client-side (see resizeImageFile in main.jsx) to stay well under
// this cap. This is the server-side half of that validation: never trust
// that the client actually resized/compressed before it POSTs here.
const MAX_AVATAR_DATA_URL_LENGTH = 400_000; // ~300KB of actual image data
const AVATAR_DATA_URL_PATTERN = /^data:image\/(png|jpe?g|webp|gif);base64,/i;

export async function handler(event) {
  if (event.httpMethod !== 'PUT') return jsonResponse(405, { message: 'Method not allowed' });

  const payload = verifyJwt(bearerToken(event));
  if (!payload) return jsonResponse(401, { message: 'Unauthorized' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { message: 'Invalid JSON' }); }

  const updates = {};
  if (body.name?.trim()) updates.name = body.name.trim();
  if (body.avatarUrl !== undefined) {
    if (!body.avatarUrl) {
      updates.avatarUrl = null;
    } else if (typeof body.avatarUrl !== 'string' || !AVATAR_DATA_URL_PATTERN.test(body.avatarUrl)) {
      return jsonResponse(400, { message: 'Avatar must be a PNG, JPEG, WEBP, or GIF image.' });
    } else if (body.avatarUrl.length > MAX_AVATAR_DATA_URL_LENGTH) {
      return jsonResponse(400, { message: 'Avatar image is too large. Please choose a smaller image.' });
    } else {
      updates.avatarUrl = body.avatarUrl;
    }
  }

  if (!Object.keys(updates).length) return jsonResponse(400, { message: 'No valid fields to update' });

  const updated = await updateUser(payload.sub, updates);
  if (!updated) return jsonResponse(404, { message: 'User not found' });

  const { passwordHash, ...publicUser } = updated;
  return jsonResponse(200, { user: publicUser });
}
