// GET /.netlify/functions/auth-me
//
// Session restoration: the client presents a stored JWT on load and gets the
// current user back. This is what keeps someone signed in across page loads
// and browser restarts.
//
// It is also the ONLY server-side signal that a user with a long-lived session
// is still using the platform. Someone who signed in once and has stayed
// signed in for weeks calls this on every visit and calls auth-login never —
// so before this recorded anything, they were invisible to "Active Today" and,
// if their login event had aged out of the capped event log, indistinguishable
// from an account that had never logged in at all.
import { verifyJwt, getUserById, bearerToken, recordSuccessfulAuth, AUTH_METHOD, jsonResponse } from './_authStore.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { message: 'Method not allowed' });

  const payload = verifyJwt(bearerToken(event));
  // An absent, forged, or expired token stops here and records NOTHING. This
  // is the failed-authentication branch: verifyJwt checks the HMAC signature
  // and the expiry, so getting past it means the bearer really does hold a
  // token this server signed and that has not expired.
  if (!payload) return jsonResponse(401, { message: 'Invalid or expired token' });

  const user = await getUserById(payload.sub);
  if (!user) return jsonResponse(404, { message: 'User not found' });

  // A restored session is authenticated ACTIVITY, not a fresh LOGIN — nobody
  // typed a password. So `isLogin: false` refreshes lastActiveAt (feeding
  // Active Today / Active This Week) without moving lastLoginAt, which would
  // otherwise make "logged in today" mean nothing more than "had the tab open".
  //
  // It DOES set hasLoggedIn, and that is deliberate and sound: a validly
  // signed, unexpired JWT can only exist because this user authenticated
  // successfully at some earlier point. For accounts predating login tracking
  // this is the self-healing path — the first time a legacy user opens the
  // site, they are correctly reclassified. See _loginBackfill.mjs.
  await recordSuccessfulAuth(user.id, { method: AUTH_METHOD.SESSION, isLogin: false });

  const { passwordHash, ...publicUser } = user;
  return jsonResponse(200, { user: publicUser });
}
