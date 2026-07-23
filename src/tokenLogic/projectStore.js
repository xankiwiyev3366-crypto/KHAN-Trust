// Project storage dedup/merge, extracted verbatim from src/main.jsx. Identifies
// when a scanned token is "the same" as a stored one (dedupableContract /
// findStoredProject), merges saved user metadata onto a fresh live scan
// (mergeStoredMetadata), and upserts the result into the local project list.
// Deps: format/trustScore sentinels, roadmap text, and the project model.
import { hasValue } from '../lib/trustScore.js';
import { storedMetadataValue } from '../format.js';
import { roadmapToText } from '../roadmap.js';
import { normalizeProject, syncSocialData } from './project.js';

export function hasSavedRoadmap(project = {}) {
  if (hasValue(project.roadmapText)) return true;
  return Boolean(project.roadmap?.some((item) => hasValue(item.phase) && item.phase !== 'Roadmap proof needed'));
}

// Native chain coins (BTC, ETH, SOL, BNB, ...) all share the same literal
// placeholder contract string (see lookupNativeCoinGeckoAsset) since they
// have no real contract address - that string must never be used to match
// two stored projects as "the same token", or scanning e.g. ETH after BTC
// would overwrite Bitcoin's stored profile with Ethereum's. Their id (e.g.
// "native-bitcoin") is already the real unique identity for these.
export const NON_DEDUPABLE_CONTRACTS = new Set(['not provided', 'native asset (no contract)']);

export function dedupableContract(contract) {
  const normalized = contract?.toLowerCase();
  return normalized && !NON_DEDUPABLE_CONTRACTS.has(normalized) ? normalized : null;
}

export function findStoredProject(items = [], project = {}) {
  const normalizedContract = dedupableContract(project.contract);
  return items.find((item) => {
    const sameId = item.id === project.id;
    const sameContract = normalizedContract && dedupableContract(item.contract) === normalizedContract;
    return sameId || sameContract;
  });
}

export function mergeStoredMetadata(liveProject = {}, storedProject = null) {
  if (!storedProject) return liveProject;

  const merged = {
    ...liveProject,
    id: storedProject.id || liveProject.id,
    verificationStatus: storedProject.verificationStatus || liveProject.verificationStatus,
  };
  ['website', 'twitter', 'telegram', 'github', 'founderStatus', 'description', 'riskNotes'].forEach((field) => {
    const savedValue = storedMetadataValue(storedProject[field]);
    if (savedValue !== undefined && !hasValue(merged[field])) merged[field] = savedValue;
  });

  const savedCommunitySize = storedMetadataValue(storedProject.communitySize);
  if (savedCommunitySize !== undefined && !Number(merged.communitySize || merged.realData?.holderCount || 0)) {
    merged.communitySize = Number(savedCommunitySize);
  }

  if (!hasSavedRoadmap(merged) && hasSavedRoadmap(storedProject)) {
    merged.roadmapText = storedProject.roadmapText || roadmapToText(storedProject.roadmap);
    merged.roadmap = storedProject.roadmap;
  }

  if (merged.realData) {
    merged.realData = syncSocialData(merged.realData, merged);
  }

  return merged;
}

export function upsertProject(items, project) {
  const normalizedContract = dedupableContract(project.contract);
  const existing = findStoredProject(items, project);
  const mergedProject = normalizeProject(mergeStoredMetadata(project, existing));
  const projectWithGrowth = applyHolderGrowth(mergedProject, existing);
  const withoutExisting = items.filter((item) => {
    const sameId = item.id === projectWithGrowth.id;
    const sameContract = normalizedContract && dedupableContract(item.contract) === normalizedContract;
    return !sameId && !sameContract;
  });
  return [projectWithGrowth, ...withoutExisting];
}

export function applyHolderGrowth(project, existing) {
  return project;
}
