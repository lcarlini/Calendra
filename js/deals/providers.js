/**
 * Deals source registry. Every requested source has an honest status.
 *
 * Integration levels:
 *   'feed'        official RSS feed (Adrenaline), read live by the page through a same-origin snapshot
 *   'snapshot'    read every 3 hours by the "Snapshot prices" GitHub Action, only on robots.txt-allowed pages
 *                 (product/category pages on Buscapé and Zoom, Pelando search, Promobit recent offers, Gatry, Hardmob)
 *   'via'         a store that refuses automated requests; its prices appear through the offers Buscapé and Zoom list
 *   'unavailable' no permitted, reliable automated access: only a search link is offered
 *
 * Checked on 2026-11-07. Nothing is bypassed: a site that refuses (HTTP 403, bot challenge) is reported as refusing,
 * search pages that robots.txt disallows are never read, and requests carry an honest user agent.
 */

export const CHECKED_ON = '2026-11-07';

export const PROVIDERS = [
  {
    id: 'adrenaline-ofertas',
    name: 'Adrenaline Ofertas',
    role: 'Community deal discovery',
    integration: 'feed',
    snapshotId: 'adrenaline',
    sourceType: 'community',
    homepage: 'https://forum.adrenaline.com.br/forums/ofertas.221/',
    detail: 'Official public RSS feed (robots.txt allows it). Shows the newest threads only; the feed has no older pages.',
    siteQuery: 'site:forum.adrenaline.com.br',
  },
  {
    id: 'buscape',
    name: 'Buscapé',
    role: 'Price comparison: offers from many stores and a 40-day price history',
    integration: 'snapshot',
    snapshotId: 'buscape',
    homepage: 'https://www.buscape.com.br/',
    detail: 'Product and category pages of the watched products. Its search pages are disallowed by robots.txt, so free-text search stays a link.',
    siteQuery: 'site:buscape.com.br',
  },
  {
    id: 'zoom',
    name: 'Zoom',
    role: 'Price comparison: offers from many stores and a 40-day price history',
    integration: 'snapshot',
    snapshotId: 'zoom',
    homepage: 'https://www.zoom.com.br/',
    detail: 'Same pages as Buscapé (same platform). Search pages are disallowed by robots.txt.',
    siteQuery: 'site:zoom.com.br',
  },
  {
    id: 'pelando',
    name: 'Pelando',
    role: 'Community deal discovery',
    integration: 'snapshot',
    snapshotId: 'pelando',
    homepage: 'https://www.pelando.com.br/',
    detail: 'Its search page for each watched product (allowed by robots.txt). It refuses cloud servers (HTTP 403), so the results of the last run that got through are kept with their date.',
    siteQuery: 'site:pelando.com.br',
  },
  {
    id: 'promobit',
    name: 'Promobit',
    role: 'Community deal discovery',
    integration: 'snapshot',
    snapshotId: 'promobit',
    homepage: 'https://www.promobit.com.br/',
    detail: 'Its recent-offers page (search is disallowed by robots.txt), filtered for the watched products.',
    siteQuery: 'site:promobit.com.br',
  },
  {
    id: 'gatry',
    name: 'Gatry',
    role: 'Community deal discovery',
    integration: 'snapshot',
    snapshotId: 'gatry',
    homepage: 'https://www.gatry.com/',
    detail: 'Its promotion search for each watched product (no robots.txt restriction).',
    siteQuery: 'site:gatry.com',
  },
  {
    id: 'hardmob-promocoes',
    name: 'Hardmob Promoções',
    role: 'Community deal discovery',
    integration: 'snapshot',
    snapshotId: 'hardmob',
    homepage: 'https://www.hardmob.com.br/forums/407-Promocoes',
    detail: 'The Promoções forum list (allowed by robots.txt). It answers HTTP 403 to an honestly identified client, from the cloud and from a home connection; that is not bypassed.',
    siteQuery: 'site:hardmob.com.br',
  },
  {
    id: 'amazon',
    name: 'Amazon Brasil',
    role: 'Store',
    integration: 'via',
    storeMatch: 'amazon',
    homepage: 'https://www.amazon.com.br/',
    reason: 'Direct pages refuse automated requests (HTTP 503) and the product API needs an Associates account with a secret key.',
    siteQuery: 'site:amazon.com.br',
  },
  {
    id: 'mercadolivre',
    name: 'Mercado Livre',
    role: 'Store',
    integration: 'via',
    storeMatch: 'mercado ?livre',
    homepage: 'https://www.mercadolivre.com.br/',
    reason: 'Its pages send automated requests to an account verification, and its API answers HTTP 403 without an app token.',
    siteQuery: 'site:mercadolivre.com.br',
  },
  {
    id: 'magalu',
    name: 'Magazine Luiza',
    role: 'Store',
    integration: 'via',
    storeMatch: 'magazine ?luiza|magalu',
    homepage: 'https://www.magazineluiza.com.br/',
    reason: 'Direct pages answer HTTP 403 to automated requests.',
    siteQuery: 'site:magazineluiza.com.br',
  },
  {
    id: 'kabum',
    name: 'KaBuM!',
    role: 'Store',
    integration: 'via',
    storeMatch: 'kabum',
    homepage: 'https://www.kabum.com.br/',
    reason: 'Its search pages are disallowed by robots.txt and its catalog API answers HTTP 403.',
    siteQuery: 'site:kabum.com.br',
  },
  {
    id: 'shopee',
    name: 'Shopee',
    role: 'Store',
    integration: 'via',
    storeMatch: 'shopee',
    homepage: 'https://shopee.com.br/',
    reason: 'Its pages and APIs answer HTTP 403 without an approved partner application.',
    siteQuery: 'site:shopee.com.br',
  },
  {
    id: 'aliexpress',
    name: 'AliExpress',
    role: 'Store',
    integration: 'via',
    storeMatch: 'aliexpress',
    homepage: 'https://www.aliexpress.com/',
    reason: 'Its pages answer HTTP 403 and its APIs need an approved affiliate application.',
    siteQuery: 'site:aliexpress.com',
  },
  {
    id: 'hardmob-classificados',
    name: 'Hardmob Classificados',
    role: 'Used-item listings',
    integration: 'unavailable',
    homepage: 'https://www.hardmob.com.br/forums/224-Classificados-Vendas-Usados',
    reason: 'Same site as Hardmob Promoções: it refuses an honestly identified client (HTTP 403).',
    siteQuery: 'site:hardmob.com.br classificados',
  },
  {
    id: 'meliuz',
    name: 'Méliuz',
    role: 'Coupons and cashback',
    integration: 'unavailable',
    homepage: 'https://www.meliuz.com.br/',
    reason: 'No public coupon feed or API found. Use the coupon finder below for ready searches.',
    siteQuery: 'site:meliuz.com.br cupom',
  },
  {
    id: 'pcpartpicker',
    name: 'PCPartPicker',
    role: 'PC hardware (US prices)',
    integration: 'unavailable',
    homepage: 'https://pcpartpicker.com/',
    reason: 'It answered with a bot challenge (HTTP 403) and offers no public API.',
    siteQuery: 'site:pcpartpicker.com',
  },
  {
    id: 'google-shopping',
    name: 'Google Shopping',
    role: 'Product and offer discovery',
    integration: 'unavailable',
    homepage: 'https://www.google.com/shopping',
    reason: 'No shopper search API (the Content API for Shopping was sunset). Only a link to Google is offered.',
    siteQuery: '',
  },
];

export const integratedProviders = () => PROVIDERS.filter((p) => p.integration === 'feed');
/** Every source a user can also search by hand (all but the live feed). */
export const unavailableProviders = () => PROVIDERS.filter((p) => p.integration !== 'feed');
export const linkOnlyProviders = () => PROVIDERS.filter((p) => p.integration === 'unavailable');

export function googleSearchUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/** The ready-made search a user can run themselves for one provider. Never presented as live results. */
export function fallbackQuery(provider, product) {
  const text = String(product || '').trim();
  return provider.siteQuery ? `${provider.siteQuery} ${text}`.trim() : text;
}

/** Extra helpful queries from the plan (price history, coupon). */
export function helperQueries(product) {
  const text = String(product || '').trim();
  return [
    { label: 'Price history', query: `${text} histórico de preço` },
    { label: 'Coupon', query: `${text} cupom` },
    { label: 'US price', query: `${text} price site:amazon.com OR site:bestbuy.com` },
  ].filter(() => text);
}

/** Coupon sites searched through Google (links only: their pages are never read by this app). */
export const COUPON_SITES = [
  { id: 'cuponomia', name: 'Cuponomia', siteQuery: 'site:cuponomia.com.br' },
  { id: 'meliuz', name: 'Méliuz', siteQuery: 'site:meliuz.com.br' },
  { id: 'promobit', name: 'Promobit', siteQuery: 'site:promobit.com.br' },
  { id: 'pelando', name: 'Pelando', siteQuery: 'site:pelando.com.br' },
  { id: 'cupomvalido', name: 'Cupom Válido', siteQuery: 'site:cupomvalido.com.br' },
];
export const COUPON_STORES = ['Amazon', 'Mercado Livre', 'Shopee', 'AliExpress', 'Kabum', 'Magalu', 'Pichau', 'Terabyte'];

export function couponSearches(query) {
  const text = String(query || '').trim();
  const month = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const subject = text ? `cupom de desconto ${text}` : 'cupom de desconto';
  return [
    { label: `Google: ${subject} ${month}`, query: `${subject} ${month}` },
    ...COUPON_SITES.map((s) => ({ label: s.name, query: `${s.siteQuery} ${subject}` })),
  ];
}
