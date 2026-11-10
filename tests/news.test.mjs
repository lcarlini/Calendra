// Run with: node --test tests/news.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SOURCES, integratedSources, sourceById } from '../js/news/sources.js';
import { decodeEntities, getTag, parseFeed, parseFeedDate, stripHtml } from '../js/news/rss.js';
import { articleTags, canonicalUrl, makeExcerpt, normalizeTitle, toArticle } from '../js/news/normalize.js';
import {
  buildStories,
  clusterArticles,
  coverageUnits,
  dedupeArticles,
  explainCluster,
  mergeSameHeadline,
  rankClusters,
  related,
  titleEntities,
  titleTokens,
} from '../js/news/cluster.js';

const NOW = Date.parse('2026-11-07T15:00:00Z');
const FETCHED = new Date(NOW).toISOString();

let counter = 0;
function art(sourceId, title, { minutesAgo = 30, url, position = 0, language, category, excerpt } = {}) {
  const source = sourceById(sourceId);
  counter += 1;
  return toArticle(
    {
      title,
      link: url || `https://example.test/${sourceId}/${counter}`,
      publishedAt: new Date(NOW - minutesAgo * 60000).toISOString(),
      categories: category ? [category] : [],
      excerptHtml: excerpt || '',
      position,
    },
    language ? { ...source, language } : source,
    FETCHED
  );
}

// --- sources ------------------------------------------------------------------

test('all eight requested sources are listed; unavailable ones say why', () => {
  assert.equal(SOURCES.length, 11);
  const names = SOURCES.map((s) => s.name).sort();
  assert.deepEqual(names, ['BBC News Brasil', 'CNN Brasil', 'DutchNews.nl', 'Globo.com', 'O Antagonista', 'UOL', 'UOL Economia', 'g1', 'g1 Economia', 'g1 Mundo', 'g1 Política']);
  for (const s of SOURCES) {
    assert.ok(s.homepage.startsWith('https://'), `${s.id} keeps a direct publisher link`);
    if (!s.feed) assert.ok(s.unavailableReason, `${s.id} explains why it is unavailable`);
  }
  assert.equal(integratedSources().length, 10);
  assert.equal(sourceById('globo').feed, null);
});

test('UOL and UOL Economia share a publisher group, g1 and Globo share one', () => {
  assert.equal(sourceById('uol').group, sourceById('uol-economia').group);
  assert.equal(sourceById('g1').group, sourceById('globo').group);
});

// --- RSS parsing ----------------------------------------------------------------

test('decodeEntities and stripHtml', () => {
  assert.equal(decodeEntities('A &amp; B &#233; &#x41; &unknown;'), 'A & B é A &unknown;');
  assert.equal(stripHtml("<img src='x' /> Texto <b>com</b> tags &amp; mais"), 'Texto com tags & mais');
  assert.equal(stripHtml('<script>alert(1)</script>ok'), 'ok');
});

test('getTag unwraps CDATA and decodes plain entities', () => {
  assert.equal(getTag('<title><![CDATA[Olá <b>mundo</b>]]></title>', 'title'), 'Olá <b>mundo</b>');
  assert.equal(getTag('<link>https://x.test/?a=1&amp;b=2</link>', 'link'), 'https://x.test/?a=1&b=2');
  assert.equal(getTag('<atom:subtitle>Sub</atom:subtitle>', 'atom:subtitle'), 'Sub');
  assert.equal(getTag('<a></a>', 'title'), '');
});

test('parseFeedDate handles RFC-822, Portuguese weekdays/months, junk and far-future dates', () => {
  assert.equal(parseFeedDate('Sat, 07 Nov 2026 09:29:22 GMT', NOW), '2026-11-07T09:29:22.000Z');
  assert.equal(parseFeedDate('Sáb, 07 Nov 2026 09:21:17 -0200', NOW), '2026-11-07T11:21:17.000Z');
  assert.equal(parseFeedDate('Qui, 05 Fev 2026 10:00:00 -0300', NOW), '2026-02-05T13:00:00.000Z');
  assert.equal(parseFeedDate('not a date', NOW), '');
  assert.equal(parseFeedDate('', NOW), '');
  assert.equal(parseFeedDate('Sat, 07 Nov 2027 09:29:22 GMT', NOW), '', 'far-future dates are dropped');
});

const SAMPLE = `<?xml version="1.0"?><rss xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Feed</title>
<item><title><![CDATA[Gonet pede ao STF suspensão de ações]]></title>
<atom:subtitle>Procurador-geral afirma que decisões geram insegurança jurídica.</atom:subtitle>
<link>https://g1.globo.com/politica/noticia/2026/11/07/gonet-pede.ghtml?utm_source=x#top</link>
<description><![CDATA[ <img src="a.jpg"> Texto longo do corpo ]]></description>
<pubDate>Sat, 07 Nov 2026 13:00:00 -0000</pubDate><category><![CDATA[Política]]></category><category>Brasil</category></item>
<item><title>Tea leaves &amp; turmoil</title><link>https://www.dutchnews.nl/2026/11/tea/</link>
<description><![CDATA[<img width="200" src="x.jpg" class="a">If the characters feel real, it is because they are.]]></description>
<pubDate>Sat, 07 Nov 2026 08:35:25 +0000</pubDate></item>
<item><title></title><link>https://x.test/empty-title</link></item>
</channel></rss>`;

test('parseFeed extracts items in feed order, prefers atom:subtitle, keeps categories', () => {
  const items = parseFeed(SAMPLE, { now: NOW });
  assert.equal(items.length, 3);
  assert.equal(items[0].position, 0);
  assert.equal(items[0].title, 'Gonet pede ao STF suspensão de ações');
  assert.equal(items[0].excerptHtml, 'Procurador-geral afirma que decisões geram insegurança jurídica.');
  assert.deepEqual(items[0].categories, ['Política', 'Brasil']);
  assert.equal(items[1].title, 'Tea leaves & turmoil');
  assert.equal(items[1].publishedAt, '2026-11-07T08:35:25.000Z');
  assert.deepEqual(parseFeed('not xml'), []);
  assert.deepEqual(parseFeed(''), []);
});

// --- normalization --------------------------------------------------------------

test('canonicalUrl strips tracking, fragments, www and trailing slash but keeps real parameters', () => {
  assert.equal(
    canonicalUrl('https://www.bbc.com/portuguese/articles/cr62yv4gjd97o?at_medium=RSS&at_campaign=rss'),
    'https://bbc.com/portuguese/articles/cr62yv4gjd97o'
  );
  assert.equal(canonicalUrl('https://G1.globo.com/a/b.ghtml?utm_source=x&id=7#top'), 'https://g1.globo.com/a/b.ghtml?id=7');
  assert.equal(canonicalUrl('https://example.test/a/'), 'https://example.test/a');
  assert.equal(canonicalUrl('https://example.test/'), 'https://example.test/');
  assert.equal(canonicalUrl('https://example.test/a?b=2&a=1'), canonicalUrl('https://example.test/a?a=1&b=2'));
});

test('normalizeTitle ignores accents, case and punctuation', () => {
  assert.equal(normalizeTitle('  Lula é “reeleito”: Brasil!  '), 'lula e reeleito brasil');
});

test('makeExcerpt drops excerpts that merely repeat the title and trims long ones', () => {
  assert.equal(makeExcerpt('Gonet pede ao STF', 'Gonet pede ao STF'), '');
  assert.equal(makeExcerpt('x'.repeat(500), 'Other title').length, 220);
  assert.ok(makeExcerpt('x'.repeat(500), 'Other title').endsWith('…'));
  assert.equal(makeExcerpt('', 't'), '');
});

test('toArticle: headline/excerpt only, no images, stable id, rejects items without title or link', () => {
  const items = parseFeed(SAMPLE, { now: NOW });
  const a = toArticle(items[0], sourceById('g1'), FETCHED);
  assert.equal(a.contentAvailability, 'excerpt-only');
  assert.equal(a.canonicalUrl, 'https://g1.globo.com/politica/noticia/2026/11/07/gonet-pede.ghtml');
  assert.equal(a.imageUrl, undefined);
  assert.equal(a.permittedContent, undefined);
  assert.equal(a.language, 'pt');
  assert.equal(a.publisherGroup, 'Globo');
  assert.equal(a.id, toArticle(items[0], sourceById('g1'), FETCHED).id);
  assert.equal(toArticle(items[2], sourceById('g1'), FETCHED), null, 'empty title is rejected');
  assert.equal(toArticle({ title: 'x', link: 'javascript:alert(1)' }, sourceById('g1'), FETCHED), null, 'non-http link is rejected');
  const noExcerpt = toArticle({ title: 'Only a headline', link: 'https://x.test/a' }, sourceById('uol'), FETCHED);
  assert.equal(noExcerpt.contentAvailability, 'headline-only');
});

test('tabs: source tags plus an economy category', () => {
  assert.deepEqual(articleTags({ category: 'Economia' }, sourceById('g1')).sort(), ['brazil', 'economy']);
  assert.ok(articleTags({}, sourceById('uol-economia')).includes('economy'));
  assert.ok(articleTags({}, sourceById('dutchnews')).includes('netherlands'));
  assert.ok(!articleTags({}, sourceById('uol')).includes('economy'));
});

// --- step 1: duplicates -----------------------------------------------------------

test('dedupe: the same article through different URLs (tracking params) is one article', () => {
  const a = art('bbc-pt', 'Mesmo texto', { url: 'https://www.bbc.com/portuguese/articles/abc?at_medium=RSS' });
  const b = art('bbc-pt', 'Mesmo texto', { url: 'https://bbc.com/portuguese/articles/abc/' });
  assert.equal(dedupeArticles([a, b]).length, 1);
});

test('dedupe: a UOL story on UOL and UOL Economia (different URLs) is one article and remembers both', () => {
  const a = art('uol', 'Justiça suspende decisão sobre casas de apostas', { url: 'https://noticias.uol.com.br/x/1.htm' });
  const b = art('uol-economia', 'Justiça suspende decisão sobre casas de apostas', { url: 'https://economia.uol.com.br/y/1.htm' });
  const out = dedupeArticles([a, b]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].alsoIn, ['uol-economia']);
});

test('dedupe keeps distinct outlets with the same headline (they are handled as syndication, not deleted)', () => {
  const a = art('cnn-brasil', 'Reuters: Brasil anuncia novo plano', { url: 'https://cnn.test/1' });
  const b = art('bbc-pt', 'Reuters: Brasil anuncia novo plano', { url: 'https://bbc.test/1' });
  assert.equal(dedupeArticles([a, b]).length, 2);
});

test('latest view: the same long headline from g1 and BBC is one card, and its photo is kept as a variant', () => {
  const t = 'Por que infidelidade do chefe da Nvidia com suposta espiã da China preocupa EUA e o setor de IA';
  const g1 = { ...art('g1-economia', t, { url: 'https://g1.test/1' }), image: 'https://img.test/g1.jpg' };
  const bbc = { ...art('bbc-pt', t, { url: 'https://bbc.test/1' }), image: 'https://img.test/bbc.jpg' };
  const out = mergeSameHeadline(dedupeArticles([g1, bbc]));
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].alsoIn, ['bbc-pt']);
  assert.deepEqual(out[0].variants.map((v) => v.image), ['https://img.test/bbc.jpg']);
});

test('latest view: very short headlines are not merged (too generic to prove the same story)', () => {
  const a = art('g1', 'Vídeos', { url: 'https://g1.test/v1' });
  const b = art('uol', 'Vídeos', { url: 'https://uol.test/v1' });
  assert.equal(mergeSameHeadline([a, b]).length, 2);
});

// --- step 2: clusters --------------------------------------------------------------

const HEADLINES = {
  a1: 'Lula vence segundo turno e é reeleito presidente do Brasil',
  a2: 'Lula é reeleito presidente do Brasil após segundo turno apertado',
  a3: 'Lula é reeleito: veja os números do segundo turno no Brasil',
};

test('related: same event with different wording is related', () => {
  const mk = (title) => ({ article: art('g1', title), tokens: titleTokens(title), entities: titleEntities(title), time: NOW });
  assert.equal(related(mk(HEADLINES.a1), mk(HEADLINES.a2)), true);
  assert.equal(related(mk(HEADLINES.a2), mk(HEADLINES.a3)), true);
});

test('cluster: three outlets on one event form one cluster; unrelated stories stay separate', () => {
  const articles = [
    art('g1', HEADLINES.a1, { minutesAgo: 90, position: 0 }),
    art('bbc-pt', HEADLINES.a2, { minutesAgo: 60, position: 3 }),
    art('cnn-brasil', HEADLINES.a3, { minutesAgo: 30, position: 1 }),
    art('uol', 'Dólar fecha em queda com exterior e dados de inflação', { minutesAgo: 40 }),
    art('oantagonista', 'Seleção convoca novos jogadores para amistosos de novembro', { minutesAgo: 20 }),
  ];
  const clusters = clusterArticles(articles);
  assert.equal(clusters.length, 3);
  const big = clusters.find((c) => c.articles.length === 3);
  assert.ok(big);
  assert.equal(big.coverage, 3);
  assert.deepEqual(big.outlets.sort(), ['BBC', 'CNN Brasil', 'Globo']);
});

test('cluster: related-looking but different events are NOT merged (STF/Gonet request vs TRF3 decision on bets)', () => {
  const articles = [
    art('g1', 'Gonet pede ao STF suspensão de ações contra MP do fim das bets até Corte decidir sobre proibição', { minutesAgo: 120 }),
    art('uol-economia', 'Justiça suspende decisão que autorizava retomada de três casas de apostas', { minutesAgo: 100 }),
  ];
  assert.equal(clusterArticles(articles).length, 2);
});

test('cluster: different languages are never merged, even with the same words', () => {
  const pt = art('g1', 'Apple announces new iPhone in Cupertino event');
  const en = art('dutchnews', 'Apple announces new iPhone in Cupertino event');
  assert.equal(clusterArticles([pt, en]).length, 2);
});

test('cluster: the same words far apart in time are different stories', () => {
  const a = art('g1', 'Governo anuncia pacote de medidas para combustíveis e energia', { minutesAgo: 10 });
  const b = art('bbc-pt', 'Governo anuncia pacote de medidas para combustíveis e energia', { minutesAgo: 60 * 24 * 10 });
  assert.equal(clusterArticles([a, b]).length, 2);
});

test('cluster: a single article never merges into a cluster it barely relates to (half-link rule)', () => {
  const a = art('g1', 'Petrobras anuncia dividendos bilionários para acionistas', { minutesAgo: 50 });
  const b = art('uol', 'Petrobras anuncia dividendos bilionários para acionistas hoje', { minutesAgo: 45 });
  const c = art('cnn-brasil', 'Petrobras fecha acordo com sindicato sobre reajuste salarial', { minutesAgo: 40 });
  const out = clusterArticles([a, b, c]);
  assert.equal(out.length, 2);
});

// --- coverage -------------------------------------------------------------------------

test('coverage: UOL + UOL Economia is ONE outlet; BBC + UOL + g1 is three', () => {
  const t = 'Banco Central mantém taxa básica de juros em reunião do Copom';
  const uolPair = [art('uol', t), art('uol-economia', t + ' hoje')];
  assert.equal(coverageUnits(uolPair).length, 1);
  const three = [art('bbc-pt', t), art('uol', t + ' hoje'), art('g1', 'Copom mantém juros, diz Banco Central')];
  assert.equal(coverageUnits(three).length, 3);
});

test('coverage: g1 + Globo count once; repeated updates from one outlet count once', () => {
  const t = 'Chuvas fortes alagam ruas no Rio de Janeiro';
  assert.equal(coverageUnits([art('g1', t), art('globo', t)]).length, 1);
  assert.equal(coverageUnits([art('g1', t), art('g1', t + ' — atualizado'), art('g1', t + ' — veja o que se sabe')]).length, 1);
});

test('coverage: identical headlines at different publishers are syndicated copies = one unit', () => {
  const t = 'Reuters: Governo do Brasil anuncia novo plano para combustíveis';
  const units = coverageUnits([art('cnn-brasil', t), art('uol-economia', t), art('bbc-pt', 'BBC explica o plano do governo para combustíveis')]);
  assert.equal(units.length, 2);
});

// --- ranking & explanation ---------------------------------------------------------------

function story(title, outlets, minutesAgo, position = 5) {
  return outlets.map((o, i) => art(o, i === 0 ? title : `${title} — ${o} cobre`, { minutesAgo: minutesAgo + i, position }));
}

test('ranking: breadth of coverage beats freshness', () => {
  const wide = story('Presidente sanciona nova lei do mercado financeiro hoje', ['g1', 'bbc-pt', 'cnn-brasil'], 600);
  const fresh = story('Prefeitura inaugura nova praça central na cidade', ['uol'], 5);
  const ranked = buildStories([...fresh, ...wide], { now: NOW });
  assert.equal(ranked[0].coverage, 3);
  assert.equal(ranked[1].coverage, 1);
});

test('ranking: with equal coverage, fresher first; then prominence', () => {
  const older = story('Time vence clássico regional com gol nos acréscimos', ['g1', 'uol'], 600, 0);
  const newer = story('Ministro anuncia mudanças na política de transportes', ['bbc-pt', 'cnn-brasil'], 20, 9);
  const ranked = buildStories([...older, ...newer], { now: NOW });
  assert.match(ranked[0].title, /^Ministro anuncia mudanças/);
  const sameFresh1 = story('Seleção feminina estreia com vitória sobre rival', ['g1', 'uol'], 30, 8);
  const sameFresh2 = story('Cientistas descobrem nova espécie de peixe amazônico', ['bbc-pt', 'cnn-brasil'], 30, 1);
  const r2 = buildStories([...sameFresh1, ...sameFresh2], { now: NOW });
  assert.match(r2[0].title, /^Cientistas/);
});

test('ranking: user topics and region only break ties', () => {
  const econ = story('Inflação desacelera em outubro segundo instituto', ['g1', 'uol-economia'], 30, 4);
  const other = story('Festival de música anuncia atrações para o verão', ['bbc-pt', 'cnn-brasil'], 30, 4);
  const tagged = rankClusters(
    buildStories([...econ, ...other], { now: NOW }),
    { now: NOW, topics: ['economy'] }
  );
  assert.ok(tagged[0].tags.includes('economy'));
  // Breadth still wins over a preferred topic.
  const wide = story('Aprovada reforma tributária no Senado após votação', ['g1', 'bbc-pt', 'cnn-brasil'], 500, 9);
  const prefOnly = story('Dólar abre em alta no mercado financeiro hoje', ['uol-economia'], 10, 0);
  const r = buildStories([...prefOnly, ...wide], { now: NOW, topics: ['economy'] });
  assert.equal(r[0].coverage, 3);
});

test('explanation: states outlets, freshness and that breadth is not proof of truth', () => {
  const [top] = buildStories(story('Congresso aprova orçamento para o próximo ano', ['g1', 'bbc-pt', 'cnn-brasil'], 18, 0), { now: NOW });
  const ex = explainCluster(top, { now: NOW });
  assert.equal(ex.headline, 'Covered by 3 outlets');
  assert.ok(ex.reasons.some((r) => /Reported by 3 independent outlets/.test(r)));
  assert.ok(ex.reasons.some((r) => /Latest item \d+ minutes ago/.test(r)));
  assert.ok(ex.reasons.some((r) => /not that it is accurate/.test(r)));
  assert.ok(!ex.reasons.some((r) => /score/i.test(r)), 'no false-precision score');
  const single = buildStories([art('g1', 'Notícia local isolada sobre trânsito na capital', { minutesAgo: 5 })], { now: NOW })[0];
  assert.equal(explainCluster(single, { now: NOW }).headline, 'Covered by 1 outlet');
});

test('explanation notes that extra same-group copies are not extra coverage', () => {
  const t = 'Prefeitura divulga calendário de vacinação para o ano';
  const [c] = buildStories([art('uol', t, { url: 'https://u.test/1' }), art('uol-economia', t + ' completo', { url: 'https://u.test/2' })], { now: NOW });
  assert.equal(c.coverage, 1);
  assert.ok(explainCluster(c, { now: NOW }).reasons.some((r) => /not counted as extra coverage/.test(r)));
});

test('pipeline is stable on empty input', () => {
  assert.deepEqual(buildStories([], { now: NOW }), []);
  assert.deepEqual(clusterArticles([]), []);
});
