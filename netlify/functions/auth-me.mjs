import { verifyJwt, getUserById, bearerToken, jsonResponse } from './_authStore.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { message: 'Method not allowed' });

  const payload = verifyJwt(bearerToken(event));
  if (!payload) return jsonResponse(401, { message: 'Invalid or expired token' });

  const user = await getUserById(payload.sub);
  if (!user) return jsonResponse(404, { message: 'User not found' });

  const { passwordHash, ...publicUser } = user;
  return jsonResponse(200, { user: publicUser });
}
