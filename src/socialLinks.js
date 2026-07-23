// Social-link normalization, extracted verbatim from src/main.jsx. Cleans and
// merges social/website links from the various provider payload shapes
// (Dexscreener info blocks, arbitrary token metadata trees). Pure — depends
// only on the shared firstPresent/hasValue sentinels.
import { firstPresent, hasValue } from './lib/trustScore.js';

export function cleanLink(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

export function mergeSocialLinks(...items) {
  return items.reduce((links, item = {}) => ({
    website: firstPresent(links.website, item.website, item.websiteUrl),
    twitter: firstPresent(links.twitter, item.twitter, item.twitterUrl, item.xUrl),
    telegram: firstPresent(links.telegram, item.telegram, item.telegramUrl),
    discord: firstPresent(links.discord, item.discord, item.discordUrl),
    github: firstPresent(links.github, item.github, item.githubUrl),
  }), {});
}

export function extractSocialLinksFromDexInfo(info = {}) {
  const websites = Array.isArray(info.websites) ? info.websites : [];
  const socials = Array.isArray(info.socials) ? info.socials : [];
  return mergeSocialLinks(
    { website: websites.map((item) => item?.url).find(hasValue) },
    ...socials.map((item) => {
      const type = String(item?.type || item?.label || '').toLowerCase();
      const url = cleanLink(item?.url);
      if (type.includes('twitter') || type === 'x') return { twitter: url };
      if (type.includes('telegram') || type === 'tg') return { telegram: url };
      if (type.includes('discord')) return { discord: url };
      if (type.includes('github')) return { github: url };
      if (type.includes('website') || type.includes('site')) return { website: url };
      return {};
    })
  );
}

export function extractSocialLinksFromMetadata(value) {
  const links = {};
  const seen = new Set();

  const visit = (input, keyHint = '') => {
    if (input === null || input === undefined || seen.size > 1200) return;
    if (typeof input === 'string') {
      assignSocialLink(links, keyHint, input);
      return;
    }
    if (typeof input !== 'object' || seen.has(input)) return;
    seen.add(input);
    if (Array.isArray(input)) {
      input.forEach((item) => visit(item, keyHint));
      return;
    }
    Object.entries(input).forEach(([key, item]) => visit(item, key));
  };

  visit(value);
  return links;
}

export function assignSocialLink(links, keyHint, rawValue) {
  const value = cleanLink(rawValue);
  if (!value || value.length > 260) return;
  const lowerKey = String(keyHint || '').toLowerCase();
  const lowerValue = value.toLowerCase();
  const looksLikeUrl = lowerValue.startsWith('http') || lowerValue.includes('.com') || lowerValue.includes('.org') || lowerValue.includes('.io') || lowerValue.includes('.xyz');
  if (!looksLikeUrl) return;

  if (!links.telegram && (lowerKey.includes('telegram') || lowerKey === 'tg' || lowerValue.includes('t.me/') || lowerValue.includes('telegram.me/'))) {
    links.telegram = value;
    return;
  }
  if (!links.twitter && (lowerKey.includes('twitter') || lowerKey === 'x' || lowerKey === 'xurl' || lowerValue.includes('twitter.com/') || lowerValue.includes('x.com/'))) {
    links.twitter = value;
    return;
  }
  if (!links.github && (lowerKey.includes('github') || lowerValue.includes('github.com/'))) {
    links.github = value;
    return;
  }
  if (!links.website && (lowerKey.includes('website') || lowerKey.includes('site') || lowerKey.includes('url') || lowerKey.includes('homepage'))) {
    links.website = value;
  }
}
