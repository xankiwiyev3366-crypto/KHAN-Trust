// Persistence for AI-generated executive reports.
//
// Reports are stored rather than regenerated on demand for three reasons:
// every regeneration costs money; the operator must be able to re-read last
// week's brief without paying for it again; and a report's value compounds only
// if you can look back and see whether its advice was any good (which is what
// the Initiatives loop in _growthInitiatives.mjs does with them).
//
// One blob per report, keyed by timestamp — append-only, no read-modify-write,
// for the same reason as the event store.
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-growth-reports';
const PREFIX = 'reports/';

function store() {
  return getNamedStore(STORE_NAME);
}

export async function saveReport(report) {
  const id = `rpt-${Date.now()}`;
  const record = { id, ...report };
  await store().setJSON(`${PREFIX}${id}`, record);
  return record;
}

export async function listReports(limit = 20) {
  const { blobs } = await store().list({ prefix: PREFIX });
  // Keys embed a millisecond timestamp, so lexical sort is chronological.
  const keys = blobs.map((blob) => blob.key).sort().reverse().slice(0, limit);
  const reports = await Promise.all(
    keys.map((key) => store().get(key, { type: 'json' }).catch(() => null))
  );
  return reports.filter(Boolean);
}

export async function latestReport() {
  const [report] = await listReports(1);
  return report || null;
}

export { jsonResponse };
