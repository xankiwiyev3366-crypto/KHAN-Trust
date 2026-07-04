import { checkPasscode, issueToken } from './_adminAuth.mjs';
import { jsonResponse } from './_verificationStore.mjs';

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { message: 'Invalid request body' });
    }
    if (!checkPasscode(payload.passcode)) {
      return jsonResponse(401, { message: 'Incorrect passcode.' });
    }
    return jsonResponse(200, { token: issueToken() });
  } catch (error) {
    return jsonResponse(500, { message: `verification-admin-auth crashed: ${error.message}` });
  }
}
