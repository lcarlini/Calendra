/**
 * Deduplication, story clustering and explainable ranking.
 *
 * Two separate steps:
 *  1. dedupeArticles: the same article reached through different URLs or placements.
 *  2. clusterArticles: different articles that report the same event (same language only).
 *
 * Coverage counting is deliberately conservative (see coverageUnits): sources of one publisher
 * group (UOL and UOL Economia, g1 and Globo), identical headlines (syndicated copies) and repeated
 * updates from one outlet are ONE unit of coverage. Breadth of coverage is a ranking signal,
 * never evidence that a story is true.
 */
import { normalizeTitle } from './normalize.js';

export const CLUSTER_WINDOW_HOURS = 48;

const STOPWORDS = new Set(
  (
    // pt
    'a o as os um uma uns umas de da do das dos em no na nos nas por para com sem sob sobre entre ate apos ante e ou mas que se ao aos ' +
    'como mais menos muito pouco ja nao sim foi sao ser tem ter diz dizem disse apos contra desde tambem sera seu sua seus suas esta este ' +
    'essa esse isso eles elas ele ela lhe quem quando onde qual quais ' +
    // en
    'the an and or of to in on at for with by from as is are was were be been it its this that these those after before over under into ' +
    'says say said will would has have had not but also than their his her they them we you i ' +
    // nl
    'de het een en van op te voor met bij uit naar is zijn was dat die dit er ook maar niet'
  ).split(' ')
);

export function titleTokens(title) {
  return new Set(
    normalizeTitle(title)
      .split(' ')
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
  );
}

/** Proper-noun-like and numeric entities from the original title (first word excluded). */
export function titleEntities(title) {
  const words = String(title ?? '')
    .replace(/[“”"'‘’]/g, ' ')
    .split(/[\s:;,.!?()–—-]+/)
    .filter(Boolean);
  const out = new Set();
  words.forEach((w, i) => {
    const plain = normalizeTitle(w).replace(/\s+/g, '');
    if (plain.length < 2 || STOPWORDS.has(plain)) return;
    const isNumber = /^\d[\d.,%]*$/.test(w) && plain.length >= 2;
    const isAcronym = /^[A-ZÀ-Ý]{2,}$/.test(w);
    const isCapital = i > 0 && /^[A-ZÀ-Ý][a-zà-ÿ]+/.test(w) && plain.length >= 3;
    if (isNumber || isAcronym || isCapital) out.add(plain);
  });
  return out;
}

function intersectionSize(a, b) {
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n;
}

function prep(article) {
  return {
    article,
    tokens: titleTokens(article.title),
    entities: titleEntities(article.title),
    time: article.publishedAt ? Date.parse(article.publishedAt) : NaN,
  };
}

/**
 * Are two prepared articles about the same event? Conservative rules:
 *  - same language only (no cross-language merging without a validated multilingual method);
 *  - published within the window when both have dates;
 *  - enough shared distinctive words, or shared named entities plus some overlap.
 */
export function related(a, b, windowHours = CLUSTER_WINDOW_HOURS) {
  if (a.article.language !== b.article.language) return false;
  if (!Number.isNaN(a.time) && !Number.isNaN(b.time) && Math.abs(a.time - b.time) > windowHours * 3600 * 1000) return false;
  const shared = intersectionSize(a.tokens, b.tokens);
  if (shared < 2) return false;
  const union = a.tokens.size + b.tokens.size - shared;
  const jaccard = union ? shared / union : 0;
  const entityShared = intersectionSize(a.entities, b.entities);
  return (shared >= 3 && jaccard >= 0.35) || (entityShared >= 2 && shared >= 2 && jaccard >= 0.2);
}

/**
 * Step 1: same article via different URLs, sections or placements.
 * Duplicate = same canonical URL, or same normalized title inside one publisher group.
 * The first occurrence is kept; where else it appeared is recorded in `alsoIn`.
 */
export function dedupeArticles(articles) {
  const byUrl = new Map();
  const byGroupTitle = new Map();
  const unique = [];
  for (const article of articles) {
    const groupKey = `${article.publisherGroup || article.sourceId}|${normalizeTitle(article.title)}`;
    const existing = byUrl.get(article.canonicalUrl) || byGroupTitle.get(groupKey);
    if (existing) {
      existing.alsoIn = [...new Set([...(existing.alsoIn || []), article.sourceId])].filter((s) => s !== existing.sourceId);
      continue;
    }
    const copy = { ...article };
    byUrl.set(copy.canonicalUrl, copy);
    byGroupTitle.set(groupKey, copy);
    unique.push(copy);
  }
  return unique;
}

/**
 * Latest view: one card per identical headline, even when the outlets differ (a BBC copy on g1, a syndicated wire
 * story). The first copy is kept; the other copies' photos stay in `variants` so the card can still step through them.
 * Very short headlines are never merged (too generic to prove the same story).
 */
export function mergeSameHeadline(articles) {
  const leads = new Map();
  const out = [];
  for (const article of articles) {
    const key = normalizeTitle(article.title);
    const mergeable = key.length >= 20;
    const lead = mergeable ? leads.get(key) : undefined;
    if (lead) {
      lead.variants = [
        ...(lead.variants || []),
        { sourceId: article.sourceId, sourceName: article.sourceName, title: article.title, originalUrl: article.originalUrl, publishedAt: article.publishedAt, image: article.image, excerpt: article.excerpt },
      ];
      lead.alsoIn = [...new Set([...(lead.alsoIn || []), article.sourceId])].filter((s) => s !== lead.sourceId);
      continue;
    }
    const copy = { ...article };
    if (mergeable) leads.set(key, copy);
    out.push(copy);
  }
  return out;
}

/** Step 2: greedy, order-stable clustering. An article joins a cluster only if it relates to at least half of it. */
export function clusterArticles(articles, { windowHours = CLUSTER_WINDOW_HOURS } = {}) {
  const prepared = articles
    .map(prep)
    .sort((a, b) => (Number.isNaN(a.time) ? 0 : a.time) - (Number.isNaN(b.time) ? 0 : b.time) || a.article.position - b.article.position);
  const clusters = [];
  for (const p of prepared) {
    let best = null;
    let bestLinks = 0;
    for (const cluster of clusters) {
      const links = cluster.members.filter((m) => related(p, m, windowHours)).length;
      if (links > bestLinks) {
        best = cluster;
        bestLinks = links;
      }
    }
    if (best && bestLinks >= Math.max(1, Math.ceil(best.members.length / 2))) best.members.push(p);
    else clusters.push({ members: [p] });
  }
  return clusters.map((c) => buildCluster(c.members.map((m) => m.article)));
}

/** Union-find: sources that must not count as independent coverage are merged into one unit. */
export function coverageUnits(articles) {
  const parent = new Map(articles.map((a) => [a.id, a.id]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  const union = (a, b) => parent.set(find(a), find(b));
  const byGroup = new Map();
  const byTitle = new Map();
  for (const a of articles) {
    const g = a.publisherGroup || a.sourceId;
    if (byGroup.has(g)) union(a.id, byGroup.get(g));
    else byGroup.set(g, a.id);
    const t = normalizeTitle(a.title);
    if (byTitle.has(t)) union(a.id, byTitle.get(t)); // identical headline: syndicated copy
    else byTitle.set(t, a.id);
  }
  const units = new Map();
  for (const a of articles) {
    const root = find(a.id);
    if (!units.has(root)) units.set(root, []);
    units.get(root).push(a);
  }
  return [...units.values()].map((members) => ({
    members,
    label: [...new Set(members.map((m) => m.publisherGroup || m.sourceName))].join(' / '),
  }));
}

function buildCluster(members) {
  const sorted = [...members].sort(
    (a, b) => (a.publishedAt || '9999').localeCompare(b.publishedAt || '9999') || a.position - b.position
  );
  const lead = sorted[0];
  const units = coverageUnits(sorted);
  const times = sorted.map((m) => m.publishedAt).filter(Boolean).sort();
  return {
    id: lead.id,
    title: lead.title,
    language: lead.language,
    articles: sorted,
    coverage: units.length,
    outlets: units.map((u) => u.label),
    firstPublishedAt: times[0],
    updatedAt: times.at(-1),
    bestPosition: Math.min(...sorted.map((m) => m.position)),
    updates: sorted.length - units.length, // extra items beyond one per unit: repeated updates/copies
    tags: [...new Set(sorted.flatMap((m) => m.tags || []))],
  };
}

const BUCKET_HOURS = 6; // freshness is bucketed on purpose: no false precision

/**
 * Rank clusters: breadth of coverage first, then freshness bucket, then prominence in feeds,
 * then the user's topics / region, then number of updates. There is no numeric score.
 */
export function rankClusters(clusters, { now = Date.now(), topics = [], region = '' } = {}) {
  const bucket = (c) => (c.updatedAt ? Math.floor((now - Date.parse(c.updatedAt)) / 3600000 / BUCKET_HOURS) : 999);
  const prefers = (c) => (topics.some((t) => c.tags.includes(t)) ? 1 : 0) + (region && c.tags.includes(region) ? 1 : 0);
  return [...clusters].sort(
    (a, b) =>
      b.coverage - a.coverage ||
      bucket(a) - bucket(b) ||
      a.bestPosition - b.bestPosition ||
      prefers(b) - prefers(a) ||
      b.updates - a.updates ||
      (b.updatedAt || '').localeCompare(a.updatedAt || '')
  );
}

/** Plain-language reasons shown in the UI ("Why this story is highlighted"). */
export function explainCluster(cluster, { now = Date.now(), topics = [], region = '' } = {}) {
  const reasons = [];
  reasons.push(
    cluster.coverage > 1
      ? `Reported by ${cluster.coverage} independent outlets: ${cluster.outlets.join(', ')}`
      : `Reported by 1 outlet: ${cluster.outlets[0]}`
  );
  if (cluster.articles.length > cluster.coverage) {
    reasons.push('Extra copies and updates from the same publisher group are not counted as extra coverage');
  }
  if (cluster.updatedAt) {
    const mins = Math.max(0, Math.round((now - Date.parse(cluster.updatedAt)) / 60000));
    reasons.push(`Latest item ${mins < 60 ? `${mins} minutes` : `${Math.round(mins / 60)} hours`} ago`);
  }
  if (cluster.bestPosition <= 2) reasons.push('Near the top of at least one outlet’s feed');
  if (topics.some((t) => cluster.tags.includes(t))) reasons.push('Matches a topic you selected');
  if (region && cluster.tags.includes(region)) reasons.push('Matches your selected region');
  reasons.push('Wide coverage means many outlets reported it, not that it is accurate.');
  return {
    headline: `Covered by ${cluster.coverage} outlet${cluster.coverage === 1 ? '' : 's'}`,
    reasons,
  };
}

/** Full pipeline: dedupe → cluster → rank. */
export function buildStories(articles, options = {}) {
  const unique = dedupeArticles(articles);
  return rankClusters(clusterArticles(unique, options), options);
}
