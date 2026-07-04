// POST /.netlify/functions/early-stage-admin-action - every admin mutation on
// an early-stage project goes through this one endpoint with an `action`
// field, mirroring report-admin-action.mjs. Supported actions:
//   approve | reject | archive | feature | unfeature | hide | unhide |
//   edit | set_notes | delete
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { readEarlyStageProjects, writeEarlyStageProjects, sanitizeText, jsonResponse } from './_earlyStageStore.mjs';
import { buildEarlyStageProject } from './early-stage-submit.mjs';

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    if (!verifyToken(bearerToken(event))) {
      return jsonResponse(401, { message: 'Unauthorized' });
    }

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { message: 'Invalid request body' });
    }

    const projects = await readEarlyStageProjects();
    const index = projects.findIndex((p) => p.id === payload.projectId);
    if (index === -1) {
      return jsonResponse(404, { message: 'Project not found.' });
    }
    const project = projects[index];
    const now = new Date().toISOString();

    switch (payload.action) {
      case 'approve':
        project.status = 'approved';
        break;
      case 'reject':
        project.status = 'rejected';
        break;
      case 'archive':
        project.status = 'archived';
        break;
      case 'feature':
        project.featured = true;
        break;
      case 'unfeature':
        project.featured = false;
        break;
      case 'hide':
        project.hidden = true;
        break;
      case 'unhide':
        project.hidden = false;
        break;
      case 'set_notes':
        project.adminNotes = sanitizeText(payload.adminNotes, 5000);
        break;
      case 'edit': {
        // Rebuild the record from the edited payload but preserve immutable
        // meta (id, createdAt) and current admin state so an edit never
        // silently un-approves / un-features a live project.
        const rebuilt = buildEarlyStageProject(payload.updates || {}, {
          id: project.id,
          status: project.status,
          featured: project.featured,
          hidden: project.hidden,
          adminNotes: project.adminNotes,
          createdAt: project.createdAt,
        });
        projects[index] = rebuilt;
        await writeEarlyStageProjects(projects);
        return jsonResponse(200, { ok: true, project: rebuilt });
      }
      case 'delete': {
        const remaining = projects.filter((p) => p.id !== payload.projectId);
        await writeEarlyStageProjects(remaining);
        return jsonResponse(200, { ok: true, deleted: true });
      }
      default:
        return jsonResponse(400, { message: 'Unknown action.' });
    }

    project.updatedAt = now;
    projects[index] = project;
    await writeEarlyStageProjects(projects);

    return jsonResponse(200, { ok: true, project });
  } catch (error) {
    return jsonResponse(500, { message: `early-stage-admin-action crashed: ${error.message}` });
  }
}
