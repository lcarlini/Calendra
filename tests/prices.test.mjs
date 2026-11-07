// Price watch: page parsers (small fixtures shaped like the real pages), history merge, and the 2026-2028 simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { brl, matchesItem, mergeHistory, parseGatry, parseHardmob, parseMosaico, parsePelando, parsePromobit } from '../js/deals/price-parsers.js';
import { BASE_YEAR, SIM_YEARS, nthWeekday, priceBucket, retailEvents, seasonalFactor, simulateYear } from '../js/deals/price-sim.js';
import { itemImage, largerImage, parseFeed } from '../js/news/rss.js';

const next = (obj, canonical = 'https://www.buscape.com.br/x/produto') =>
  `<html><head><link rel="canonical" href="${canonical}"/></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(obj)}</script></body></html>`;

test('Buscapé/Zoom product page: offers and the 40-day history', () => {
  const html = next({
    props: {
      initialReduxState: {
        offers: { offerList: [{ sellerName: 'Amazon', name: 'PlayStation 5', price: 3999.9, imageUrl: 'https://img/x.jpg' }, { sellerName: 'KaBuM!', name: 'PS5', price: '4199' }] },
        priceHistory: { priceHistory: { 1: { days: [{ date: '2026-11-06', price: 4100 }, { date: 'bad', price: 1 }] } } },
        products: { product: { product: { name: ' PlayStation 5 ' } } },
      },
    },
  });
  const r = parseMosaico(html);
  assert.equal(r.kind, 'product');
  assert.equal(r.name, 'PlayStation 5');
  assert.deepEqual(r.offers.map((o) => [o.store, o.price]), [['Amazon', 3999.9], ['KaBuM!', 4199]]);
  assert.deepEqual(r.history, [{ date: '2026-11-06', price: 4100 }]);
});

test('Buscapé category page lists products; a path that resolves to a search is refused (robots.txt)', () => {
  const html = next({ props: { initialReduxState: { hits: { hits: [{ name: 'TV 55"', price: 2899, url: '/tv/x', bestOffer: { merchantName: 'Magalu' } }] } } } });
  const r = parseMosaico(html);
  assert.equal(r.kind, 'category');
  assert.equal(r.offers[0].url, 'https://www.buscape.com.br/tv/x');
  assert.throws(() => parseMosaico(next({ props: {} }, 'https://www.buscape.com.br/placa-de-video?q=rtx')), /robots\.txt/);
  assert.throws(() => parseMosaico('<html>Just a moment</html>'), /No product data/);
});

test('Pelando: Astro island props are decoded', () => {
  const props = { initialData: [0, { deals: [0, { deals: [1, [[0, { title: [0, 'Console PS5 Slim'], slug: [0, 'ps5-slim-1'], price: [0, 3499], store: [0, { name: [0, 'Amazon'] }], status: [0, 'active'], imageUrl: [0, 'https://media/0x100/a.jpg'], createdAt: [0, '2026-11-07T10:00:00Z'], temperature: [0, 300] }]]] }] }] };
  const html = `<astro-island uid="1" props="${JSON.stringify(props).replace(/"/g, '&quot;')}"></astro-island>`;
  const [d] = parsePelando(html);
  assert.equal(d.title, 'Console PS5 Slim');
  assert.equal(d.price, 3499);
  assert.equal(d.store, 'Amazon');
  assert.equal(d.url, 'https://www.pelando.com.br/d/ps5-slim-1');
  assert.match(d.image, /400x400/);
});

test('Promobit, Gatry and Hardmob lists', () => {
  const pro = parsePromobit(next({ props: { pageProps: { serverOffers: { offers: [{ offerId: 1, offerTitle: 'SSD 1TB Kingston', offerPrice: 399.9, storeName: 'Kabum', offerSlug: 'ssd-1', offerPhoto: '/a.png' }] } } } }));
  assert.equal(pro[0].url, 'https://www.promobit.com.br/oferta/ssd-1/');
  const gat = parseGatry('<article class="x"><img src="https://cdn.gatry.com/a.jpg" itemprop="image"><h3><a href="https://s.shopee/x">Console PS5 Slim</a></h3><p class="price"> R$ 3.894,05 </p><a class="option-store" href="#">Ir para Shopee</a><a href="/promocoes/1/console?comentarios">c</a></article>');
  assert.deepEqual([gat[0].price, gat[0].store, gat[0].url], [3894.05, 'Shopee', 'https://gatry.com/promocoes/1/console']);
  const hm = parseHardmob('<span id="thread_prefix_9" class="prefix"> Fixo </span><a class="title" href="threads/9-FAQ?s=1">FAQ</a><a class="title" href="threads/10-Kabum-SSD?s=1" id="t">[KABUM] SSD 1TB - R$ 399,90</a>');
  assert.equal(hm.length, 1);
  assert.deepEqual([hm[0].price, hm[0].store, hm[0].url], [399.9, 'KABUM', 'https://www.hardmob.com.br/threads/10-Kabum-SSD']);
  assert.equal(brl('por R$ 1.299,90 à vista'), 1299.9);
});

test('watchlist matching keeps the product and drops accessories and other models', () => {
  const ps5 = { match: { any: ['ps5', 'playstation 5'], not: ['controle', 'jogo'] } };
  assert.ok(matchesItem('Console Sony PlayStation 5 Slim Digital', ps5));
  assert.ok(!matchesItem('Controle DualSense PS5', ps5));
  const gpu = { match: { any: ['rtx 5070'], not: ['ti'] } };
  assert.ok(matchesItem('Placa de Vídeo MSI GeForce RTX 5070 12G', gpu));
  assert.ok(!matchesItem('RTX 5070 Ti 16GB', gpu));
  const tv = { match: { all: ['tv'], any: ['55'], not: ['65'] } };
  assert.ok(matchesItem('Smart TV Mini LED 55" TCL', tv));
  assert.ok(!matchesItem('Smart TV 65" Samsung', tv));
});

test('history merge keeps one lowest price per day, sorted', () => {
  const h = mergeHistory([{ date: '2026-11-02', price: 10 }], [{ date: '2026-11-01', price: 12 }, { date: '2026-11-02', price: 9, source: 'zoom' }, { date: '2026-11-02', price: 11 }]);
  assert.deepEqual(h, [{ date: '2026-11-01', price: 12, source: '' }, { date: '2026-11-02', price: 9, source: 'zoom' }]);
});

test('retail calendar is placed on each year (Black Friday = last Friday of November)', () => {
  const bf = (y) => retailEvents(y).find((e) => e.id === 'black-friday');
  assert.equal(bf(2026).startIso, '2026-11-26'); // Thursday before Friday 27
  assert.equal(bf(2027).startIso, '2027-11-25');
  assert.equal(bf(2028).startIso, '2028-11-23');
  assert.equal(nthWeekday(2027, 4, 0, 2).toISOString().slice(0, 10), '2027-05-09'); // Dia das Mães 2027
  assert.ok(seasonalFactor(new Date('2027-11-26T00:00:00Z'), 'gpu').factor < 0.9);
  assert.equal(seasonalFactor(new Date('2027-06-20T00:00:00Z')).factor, 1);
});

test('simulation: 2026 keeps real days, 2027/2028 are projections with Black Friday as the best window', () => {
  const history = Array.from({ length: 40 }, (_, i) => ({ date: new Date(Date.UTC(2026, 8, 29 + i)).toISOString().slice(0, 10), price: 4000 + (i % 5) * 20 }));
  assert.deepEqual(SIM_YEARS, [2026, 2027, 2028]);
  const base = simulateYear(history, { year: BASE_YEAR, category: 'console' });
  assert.equal(base.observedDays, 40);
  assert.equal(base.days.length, 365);
  assert.equal(base.days.find((d) => d.date === '2026-10-01').kind, 'observed');
  const y27 = simulateYear(history, { year: 2027, category: 'console' });
  const y28 = simulateYear(history, { year: 2028, category: 'console' });
  assert.equal(y27.observedDays, 0);
  assert.equal(y28.days.length, 366); // leap year
  assert.ok(y28.average < y27.average && y27.average < base.average, 'prices trend down for an ageing product');
  assert.equal(y27.bestWindows[0].id, 'black-friday');
  assert.ok(y27.min.date.startsWith('2027-11-2'));
  const bfDay = y27.days.find((d) => d.date === '2027-11-26');
  assert.ok(bfDay.low < bfDay.price && bfDay.price < bfDay.high);
  assert.equal(priceBucket(bfDay), 0);
  assert.equal(priceBucket(y27.days.find((d) => d.date === '2027-06-20')), 2);
  assert.equal(simulateYear([], { year: 2027 }), null);
  assert.ok(simulateYear([], { year: 2027, fallbackPrice: 1000, category: 'tv' }).average > 0);
});

test('news feed images: media tags, enclosures, first <img>; larger sizes for known publishers', () => {
  assert.equal(itemImage('<item><media:content url="https://a/x.jpg" medium="image"/></item>'), 'https://a/x.jpg');
  assert.equal(itemImage('<item><enclosure url="https://a/y.png" type="image/png"/></item>'), 'https://a/y.png');
  assert.equal(itemImage('<item><description><![CDATA[<img src="https://a/z.webp"> text]]></description></item>'), 'https://a/z.webp');
  assert.equal(itemImage('<item><media:thumbnail url="http://insecure/x.jpg"/></item>'), '');
  assert.equal(parseFeed('<rss><channel><item><title>T</title><link>https://a/1</link><media:thumbnail url="https://a/t.jpg"/></item></channel></rss>')[0].image, 'https://a/t.jpg');
  assert.equal(largerImage('https://conteudo.imguol.com.br/c/x/foto_v2_142x100.png'), 'https://conteudo.imguol.com.br/c/x/foto_v2_900x506.png');
  assert.equal(largerImage('https://ichef.bbci.co.uk/ace/ws/240/cpsprodpb/a.png'), 'https://ichef.bbci.co.uk/ace/ws/800/cpsprodpb/a.png');
  assert.equal(largerImage('https://admin.cnnbrasil.com.br/wp-content/uploads/a.jpg?w=200'), 'https://admin.cnnbrasil.com.br/wp-content/uploads/a.jpg?w=1200');
  assert.equal(largerImage('https://www.dutchnews.nl/wpcms/wp-content/uploads/2026/11/200-200x240.jpg'), 'https://www.dutchnews.nl/wpcms/wp-content/uploads/2026/11/200.jpg');
  assert.equal(largerImage('https://other/a_142x100.png'), 'https://other/a_142x100.png');
});
