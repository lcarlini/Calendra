/**
 * Deal-community feeds that are integrated (official RSS only).
 * The companion proxy serves exactly these addresses (plus the news feeds), selected by id.
 *
 * Adrenaline Ofertas: public XenForo RSS feed; the site's robots.txt allows it
 * (checked 2026-11-07). Only the thread title, a short excerpt, author, date and link are used;
 * the post body is not republished.
 */
export const DEAL_FEEDS = [
  {
    id: 'adrenaline-ofertas',
    name: 'Adrenaline Ofertas',
    homepage: 'https://forum.adrenaline.com.br/forums/ofertas.221/',
    feed: 'https://forum.adrenaline.com.br/forums/ofertas.221/index.rss',
  },
];
