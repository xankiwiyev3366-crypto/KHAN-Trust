// Persistence for AUTO-DISCOVERED early-stage projects (Phase 2). These are
// projects KHAN Trust finds automatically from public sources, as opposed to
// the manually submitted ones in early-stage-projects.json.
//
// Deliberately stored under SEPARATE keys inside the SAME early-stage blob
// store, so the manual submission/approval pipeline
// (readEarlyStageProjects/writeEarlyStageProjects) is never touched and cannot
// regress. The public list endpoint reads both and merges them at request
// time; the discovery worker only ever writes the two keys below.
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-early-stage';
const DISCOVERED_KEY = 'discovered-projects.json';
const DISCOVERY_META_KEY = 'discovery-meta.json';

function store() {
  return getNamedStore(STORE_NAME);
}

// The cached list of normalized discovered projects. This is what the public
// list endpoint reads on every request (a single fast JSON read - the network
// fetching happens only in the background worker, never on the read path).
export async function readDiscoveredProjects() {
  const data = await store().get(DISCOVERED_KEY, { type: 'json' });
  return Array.isArray(data) ? data : [];
}

export async function writeDiscoveredProjects(projects) {
  await store().setJSON(DISCOVERED_KEY, Array.isArray(projects) ? projects : []);
}

// Small metadata blob: when discovery last ran, how many providers ran, counts.
// Surfaced by the admin/status view and used to decide whether a refresh is due.
export async function readDiscoveryMeta() {
  const data = await store().get(DISCOVERY_META_KEY, { type: 'json' });
  return data && typeof data === 'object' ? data : { lastRunAt: null, runs: [] };
}

export async function writeDiscoveryMeta(meta) {
  await store().setJSON(DISCOVERY_META_KEY, meta || {});
}

export { jsonResponse };
