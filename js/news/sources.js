/**
 * News source registry.
 *
 * Integration method for every integrated source: the outlet's own public RSS feed,
 * fetched through the companion proxy (the feeds send no CORS headers, so a browser
 * cannot read them directly). Only the headline, a short feed-supplied excerpt and a link
 * back to the publisher are used. No full article text and no images are shown.
 *
 * Feed addresses below were checked on 2026-11-07 (HTTP 200 with RSS). Publisher terms of
 * use were NOT reviewed by this app; whoever deploys the proxy is responsible for complying
 * with them. A source that has no usable feed is listed as unavailable with the reason.
 *
 * `group` identifies the publisher family: two sources in one group (for example UOL and
 * UOL Economia) never count as independent coverage of a story.
 * `tags` drive the Brazil / World / Economy / Netherlands tabs.
 */
export const SOURCES = [
  {
    id: 'oantagonista',
    name: 'O Antagonista',
    group: 'O Antagonista',
    language: 'pt',
    tags: ['brazil'],
    homepage: 'https://oantagonista.com.br/',
    feed: 'https://oantagonista.com.br/feed/',
  },
  {
    id: 'globo',
    name: 'Globo.com',
    group: 'Globo',
    language: 'pt',
    tags: ['brazil'],
    homepage: 'https://www.globo.com/',
    feed: null,
    unavailableReason: 'globo.com does not publish an RSS feed (its /rss/ address returns 404). Its news is covered through g1, which is integrated.',
  },
  {
    id: 'uol',
    name: 'UOL',
    group: 'UOL',
    language: 'pt',
    tags: ['brazil'],
    homepage: 'https://www.uol.com.br/',
    feed: 'https://rss.uol.com.br/feed/noticias.xml',
  },
  {
    id: 'uol-economia',
    name: 'UOL Economia',
    group: 'UOL',
    language: 'pt',
    tags: ['brazil', 'economy'],
    homepage: 'https://economia.uol.com.br/',
    feed: 'https://rss.uol.com.br/feed/economia.xml',
  },
  {
    id: 'dutchnews',
    name: 'DutchNews.nl',
    group: 'DutchNews',
    language: 'en',
    tags: ['netherlands', 'world'],
    homepage: 'https://www.dutchnews.nl/',
    feed: 'https://www.dutchnews.nl/feed/',
  },
  {
    id: 'g1',
    name: 'g1',
    group: 'Globo',
    language: 'pt',
    tags: ['brazil'],
    homepage: 'https://g1.globo.com/',
    feed: 'https://g1.globo.com/rss/g1/',
  },
  {
    id: 'bbc-pt',
    name: 'BBC News Brasil',
    group: 'BBC',
    language: 'pt',
    tags: ['brazil', 'world'],
    homepage: 'https://www.bbc.com/portuguese',
    feed: 'https://feeds.bbci.co.uk/portuguese/rss.xml',
  },
  {
    id: 'cnn-brasil',
    name: 'CNN Brasil',
    group: 'CNN Brasil',
    language: 'pt',
    tags: ['brazil', 'world'],
    homepage: 'https://www.cnnbrasil.com.br/',
    feed: 'https://www.cnnbrasil.com.br/feed/',
  },
];

export const TABS = [
  { id: 'top', label: 'Top stories' },
  { id: 'latest', label: 'Latest' },
  { id: 'brazil', label: 'Brazil' },
  { id: 'world', label: 'World' },
  { id: 'economy', label: 'Economy' },
  { id: 'netherlands', label: 'Netherlands' },
];

export const sourceById = (id) => SOURCES.find((s) => s.id === id) || null;
export const integratedSources = () => SOURCES.filter((s) => s.feed);
