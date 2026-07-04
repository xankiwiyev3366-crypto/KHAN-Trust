import { readStatuses, jsonResponse } from './_verificationStore.mjs';

// Public endpoint - returns the single source of truth verification status
// map ({ [projectId]: { status, updatedAt, adminNote } }) consumed by
// Explore, Project Profile, Compare, and the PDF report.
export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    const statuses = await readStatuses();
    return jsonResponse(200, { statuses });
  } catch (error) {
    return jsonResponse(500, { message: `verification-status crashed: ${error.message}` });
  }
}
