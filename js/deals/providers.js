/**
 * Deals source registry. Every requested source has an honest status.
 *
 * Integration levels:
 *   'feed'        official RSS feed, read through the companion proxy
 *   'unavailable' no permitted, reliable automated access: only a search link on Google is offered
 *
 * Findings were observed on 2026-11-07 with plain, honestly-labelled requests. Nothing was bypassed:
 * bot challenges, missing credentials and missing feeds are reported as they are, and no source is
 * scraped. Publisher terms of use were not reviewed in full by this app.
 */

export const CHECKED_ON = '2026-11-07';

export const PROVIDERS = [
  {
    id: 'adrenaline-ofertas',
    name: 'Adrenaline Ofertas',
    role: 'Community deal discovery',
    integration: 'feed',
    sourceType: 'community',
    homepage: 'https://forum.adrenaline.com.br/forums/ofertas.221/',
    detail: 'Official public RSS feed (robots.txt allows it). Shows the newest threads only; the feed has no older pages.',
    siteQuery: 'site:forum.adrenaline.com.br',
  },
  {
    id: 'hardmob-promocoes',
    name: 'Hardmob Promoções',
    role: 'Community deal discovery',
    integration: 'unavailable',
    homepage: 'https://www.hardmob.com.br/forums/407-Promocoes',
    reason: 'No usable official feed: its RSS address is behind a bot challenge, which this app does not bypass, and its pages are not scraped.',
    siteQuery: 'site:hardmob.com.br',
  },
  {
    id: 'hardmob-classificados',
    name: 'Hardmob Classificados',
    role: 'Used-item listings',
    integration: 'unavailable',
    homepage: 'https://www.hardmob.com.br/forums/224-Classificados-Vendas-Usados',
    reason: 'Same as Hardmob Promoções: no official feed that can be read without bypassing a bot challenge.',
    siteQuery: 'site:hardmob.com.br classificados',
  },
  {
    id: 'pelando',
    name: 'Pelando',
    role: 'Community deal discovery',
    integration: 'unavailable',
    homepage: 'https://www.pelando.com.br/',
    reason: 'No public feed or API found (the usual feed addresses return 404).',
    siteQuery: 'site:pelando.com.br',
  },
  {
    id: 'gatry',
    name: 'Gatry',
    role: 'Community deal discovery',
    integration: 'unavailable',
    homepage: 'https://www.gatry.com/',
    reason: 'No public feed or API found (the usual feed address returns 404).',
    siteQuery: 'site:gatry.com',
  },
  {
    id: 'meliuz',
    name: 'Méliuz',
    role: 'Coupons and promotional offers',
    integration: 'unavailable',
    homepage: 'https://www.meliuz.com.br/',
    reason: 'No public coupon feed or API found. Use the coupon finder below for ready searches.',
    siteQuery: 'site:meliuz.com.br cupom',
  },
  {
    id: 'buscape',
    name: 'Buscapé',
    role: 'Price comparison',
    integration: 'unavailable',
    homepage: 'https://www.buscape.com.br/',
    reason: 'No public API or feed found. Partner programs need an approved account and a server-side key.',
    siteQuery: 'site:buscape.com.br',
  },
  {
    id: 'zoom',
    name: 'Zoom',
    role: 'Price comparison',
    integration: 'unavailable',
    homepage: 'https://www.zoom.com.br/',
    reason: 'No public API or feed found. Partner programs need an approved account and a server-side key.',
    siteQuery: 'site:zoom.com.br',
  },
  {
    id: 'pcpartpicker',
    name: 'PCPartPicker',
    role: 'PC hardware compatibility and prices',
    integration: 'unavailable',
    homepage: 'https://pcpartpicker.com/',
    reason: 'It answered with a bot challenge (HTTP 403) and offers no public API, so it is not accessed automatically.',
    siteQuery: 'site:pcpartpicker.com',
  },
  {
    id: 'amazon',
    name: 'Amazon Brasil',
    role: 'Product and price search',
    integration: 'unavailable',
    homepage: 'https://www.amazon.com.br/',
    reason: 'Its official product API needs an approved Associates account and signed requests with a secret key, which a static page cannot keep safe.',
    siteQuery: 'site:amazon.com.br',
  },
  {
    id: 'shopee',
    name: 'Shopee',
    role: 'Product and price search',
    integration: 'unavailable',
    homepage: 'https://shopee.com.br/',
    reason: 'Its official APIs need an approved partner application and server-side keys.',
    siteQuery: 'site:shopee.com.br',
  },
  {
    id: 'aliexpress',
    name: 'AliExpress',
    role: 'Product and price search',
    integration: 'unavailable',
    homepage: 'https://www.aliexpress.com/',
    reason: 'Its official APIs need an approved affiliate/open-platform application and server-side keys.',
    siteQuery: 'site:aliexpress.com',
  },
  {
    id: 'mercadolivre',
    name: 'Mercado Livre',
    role: 'Product and price search',
    integration: 'unavailable',
    homepage: 'https://www.mercadolivre.com.br/',
    reason: 'Its search API answered HTTP 403 without credentials; it now needs an approved app and an access token kept server-side.',
    siteQuery: 'site:mercadolivre.com.br',
  },
  {
    id: 'google-shopping',
    name: 'Google Shopping',
    role: 'Product and offer discovery',
    integration: 'unavailable',
    homepage: 'https://www.google.com/shopping',
    reason: 'The Content API for Shopping was sunset (replaced by the Merchant API, which manages a merchant’s own listings, not shopper search). Only a link to Google is offered.',
    siteQuery: '',
  },
];

export const integratedProviders = () => PROVIDERS.filter((p) => p.integration === 'feed');
export const unavailableProviders = () => PROVIDERS.filter((p) => p.integration !== 'feed');

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
