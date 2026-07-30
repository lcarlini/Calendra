export const FIXED_CLOCKS = [
  { id: 'chicago', city: 'Chicago', timeZone: 'America/Chicago', imageQuery: 'chicago' },
  { id: 'newyork', city: 'New York', timeZone: 'America/New_York', imageQuery: 'newyork' },
  { id: 'london', city: 'London', timeZone: 'Europe/London', imageQuery: 'london' },
  { id: 'amsterdam', city: 'Amsterdam', timeZone: 'Europe/Amsterdam', imageQuery: 'amsterdam' },
];

/**
 * Curated Unsplash photo IDs per place.
 * Each clock shows a different image each local calendar day (day-of-year rotation).
 */
const VERIFIED_IMAGES = {
  chicago: [
    'photo-1494522855154-9297ac14b55f',
    'photo-1477959858617-67f85b34b5a0',
    'photo-1514924013411-cbfbb242c8a7',
    'photo-1449824913935-59a10b8d2000',
    'photo-1480714378408-67cf0d13bc1b',
    'photo-1514565131-fce0801e5785',
    'photo-1468436139062-f60a71c5c892',
    'photo-1486325212027-8081e485255e',
    'photo-1444723121867-7a241cacace9',
    'photo-1496568816309-51d7c20e3d21',
    'photo-1519501025264-65ba15a82390',
    'photo-1486325212027-8081e485255e',
  ],
  newyork: [
    'photo-1496442226666-8d4d0e62e6e9',
    'photo-1485871981521-5b1fd3805eee',
    'photo-1522083165195-3424ed129620',
    'photo-1518391846015-55a9cc003b25',
    'photo-1500917293891-ef795e70e1f6',
    'photo-1546436836-07a91091f160',
    'photo-1518235506717-e1edbd870e98',
    'photo-1532960402127-021409877d49',
    'photo-1534430480872-3498386e7856',
    'photo-1474181487882-7ab0b40f3715',
    'photo-1541336032412-2048a678540d',
    'photo-1506353826978-0b5fd676f1e7',
  ],
  london: [
    'photo-1513635269975-59663e0ac1ad',
    'photo-1529655683826-aba9b3e77383',
    'photo-1486299267070-83823f5448dd',
    'photo-1520986606214-8b456906c813',
    'photo-1505761671935-60b3a7427bad',
    'photo-1533929736458-ca588d08c8be',
    'photo-1488747279002-c64737439555',
    'photo-1526129318478-62ed807ebdf9',
    'photo-1558618666-fcd25c85cd1c',
    'photo-1529655683826-aba9b3e77383',
    'photo-1513635269975-59663e0ac1ad',
    'photo-1505761671935-60b3a7427bad',
  ],
  amsterdam: [
    'photo-1534351590666-13e3e96b5017',
    'photo-1512470876302-972faa2aa9a4',
    'photo-1576924542622-772281b1b9a5',
    'photo-1558005530-a45227856a59',
    'photo-1562860149-691401a306f8',
    'photo-1467269204594-9661b134dd2b',
    'photo-1534351590666-13e3e96b5017',
    'photo-1512470876302-972faa2aa9a4',
    'photo-1576924542622-772281b1b9a5',
    'photo-1558005530-a45227856a59',
    'photo-1562860149-691401a306f8',
    'photo-1467269204594-9661b134dd2b',
  ],
  saopaulo: [
    'photo-1543059080-f9b1272213d5',
    'photo-1555881400-74d7acaacd8b',
    'photo-1587593810167-a84920ea0781',
    'photo-1612294037637-ec328d0e075e',
    'photo-1483729558449-99ef09a8c325',
    'photo-1544989164-31dc3c645987',
    'photo-1518639192441-8f55a555f940',
    'photo-1543059080-f9b1272213d5',
    'photo-1555881400-74d7acaacd8b',
    'photo-1587593810167-a84920ea0781',
    'photo-1612294037637-ec328d0e075e',
    'photo-1483729558449-99ef09a8c325',
  ],
  riodejaneiro: [
    'photo-1483729558449-99ef09a8c325',
    'photo-1544989164-31dc3c645987',
    'photo-1612294037637-ec328d0e075e',
    'photo-1518639192441-8f55a555f940',
    'photo-1483729558449-99ef09a8c325',
    'photo-1544989164-31dc3c645987',
    'photo-1612294037637-ec328d0e075e',
    'photo-1518639192441-8f55a555f940',
    'photo-1483729558449-99ef09a8c325',
    'photo-1544989164-31dc3c645987',
    'photo-1612294037637-ec328d0e075e',
    'photo-1518639192441-8f55a555f940',
  ],
  world: [
    'photo-1449824913935-59a10b8d2000',
    'photo-1480714378408-67cf0d13bc1b',
    'photo-1477959858617-67f85b34b5a0',
    'photo-1514565131-fce0801e5785',
    'photo-1467269204594-9661b134dd2b',
    'photo-1505761671935-60b3a7427bad',
    'photo-1494522855154-9297ac14b55f',
    'photo-1513635269975-59663e0ac1ad',
    'photo-1534351590666-13e3e96b5017',
    'photo-1496442226666-8d4d0e62e6e9',
    'photo-1543059080-f9b1272213d5',
    'photo-1483729558449-99ef09a8c325',
  ],
};

function unsplashUrl(photoId) {
  return `https://images.unsplash.com/${photoId}?auto=format&fit=crop&w=900&q=80`;
}

function imagePoolFor(clock) {
  const key = clock.imageQuery || clock.id;
  if (VERIFIED_IMAGES[key]) return VERIFIED_IMAGES[key];

  const tz = (clock.timeZone || '').toLowerCase();
  if (tz.includes('sao_paulo') || tz.includes('fortaleza') || tz.includes('recife') || tz.includes('bahia')) {
    return VERIFIED_IMAGES.saopaulo;
  }
  if (tz.includes('rio')) return VERIFIED_IMAGES.riodejaneiro;
  if (tz.includes('chicago')) return VERIFIED_IMAGES.chicago;
  if (tz.includes('new_york') || tz.includes('detroit') || tz.includes('toronto')) {
    return VERIFIED_IMAGES.newyork;
  }
  if (tz.includes('london')) return VERIFIED_IMAGES.london;
  if (tz.includes('amsterdam') || tz.includes('berlin') || tz.includes('paris')) {
    return VERIFIED_IMAGES.amsterdam;
  }
  return VERIFIED_IMAGES.world;
}

function dayKeyInZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function dayOfYearInZone(date, timeZone) {
  const key = dayKeyInZone(date, timeZone);
  const [y, m, d] = key.split('-').map(Number);
  const start = Date.UTC(y, 0, 0);
  const current = Date.UTC(y, m - 1, d);
  return Math.floor((current - start) / 86400000);
}

export function dailyImageFor(clock, date = new Date()) {
  const pool = imagePoolFor(clock);
  const idx = dayOfYearInZone(date, clock.timeZone);
  const salt = [...(clock.id || 'x')].reduce((a, c) => a + c.charCodeAt(0), 0);
  return unsplashUrl(pool[(idx + salt) % pool.length]);
}

export function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function partsFor(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const map = Object.fromEntries(
    dtf.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
  );

  return {
    time: `${map.hour}:${map.minute}:${map.second}`,
    date: `${map.weekday}, ${map.month} ${map.day}`,
  };
}

/** Short zone name: EST, EDT, CST, GMT, CET, CEST, BRT, etc. */
export function zoneAbbr(date, timeZone) {
  try {
    const part = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'short',
      hour: '2-digit',
    })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName');
    return part?.value || '';
  } catch {
    return '';
  }
}

/** Offset label: GMT-5 / UTC-3 */
export function zoneOffset(date, timeZone) {
  try {
    const part = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
      hour: '2-digit',
    })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName');
    return part?.value || '';
  } catch {
    return '';
  }
}

function offsetCompare(date, timeZone, baseZone) {
  const a = zoneOffset(date, timeZone);
  const b = zoneOffset(date, baseZone);
  if (!a || !b || a === b) return a || '';
  return `${a} · you ${b}`;
}

function imageKeyFor(clock, date) {
  return `${clock.id}:${dayKeyInZone(date, clock.timeZone)}`;
}

function guessImageQuery(timeZone, city) {
  const tz = timeZone.toLowerCase();
  const c = (city || '').toLowerCase();
  if (tz.includes('chicago') || c.includes('chicago')) return 'chicago';
  if (tz.includes('new_york') || c.includes('new york')) return 'newyork';
  if (tz.includes('london') || c.includes('london')) return 'london';
  if (tz.includes('amsterdam') || c.includes('amsterdam')) return 'amsterdam';
  if (
    tz.includes('sao_paulo') ||
    c.includes('paulo') ||
    c.includes('poços') ||
    c.includes('pocos') ||
    c.includes('caldas')
  ) {
    return 'saopaulo';
  }
  if (c.includes('rio') || tz.includes('rio')) return 'riodejaneiro';
  if (tz.startsWith('america/sao') || tz.startsWith('america/bahia') || tz.startsWith('america/fortaleza')) {
    return 'saopaulo';
  }
  return 'world';
}

export function buildClockList(localCity = 'Local') {
  const zone = localTimeZone();
  const local = {
    id: 'local',
    city: localCity,
    timeZone: zone,
    isLocal: true,
    imageQuery: guessImageQuery(zone, localCity),
  };

  const fixed = FIXED_CLOCKS.filter((c) => c.timeZone !== zone);
  return [local, ...fixed];
}

function clockCardHtml(clock, now, baseZone) {
  const { time, date } = partsFor(now, clock.timeZone);
  const abbr = zoneAbbr(now, clock.timeZone);
  const offset = clock.isLocal
    ? `${clock.timeZone.replace(/_/g, ' ')} · ${zoneOffset(now, clock.timeZone)}`
    : offsetCompare(now, clock.timeZone, baseZone);
  const img = dailyImageFor(clock, now);
  const imgKey = imageKeyFor(clock, now);

  return `
    <article class="clock-card ${clock.isLocal ? 'local' : ''}" data-clock="${clock.id}" data-img-key="${imgKey}">
      <div class="clock-media" aria-hidden="true">
        <img class="clock-image" src="${img}" alt="" loading="lazy" decoding="async" />
        <div class="clock-media-shade"></div>
        <span class="clock-tz-badge" title="Timezone">${abbr || '—'}</span>
      </div>
      <div class="clock-body">
        <div class="clock-city">${clock.city}${clock.isLocal ? ' · You' : ''}</div>
        <div class="clock-time">${time}</div>
        <div class="clock-date">${date}</div>
        <div class="clock-meta">
          <span class="clock-abbr">${abbr}</span>
          <span class="clock-offset">${offset}</span>
        </div>
      </div>
    </article>
  `;
}

function updateClockCard(card, clock, now, baseZone) {
  const { time, date } = partsFor(now, clock.timeZone);
  const abbr = zoneAbbr(now, clock.timeZone);
  const offset = clock.isLocal
    ? `${clock.timeZone.replace(/_/g, ' ')} · ${zoneOffset(now, clock.timeZone)}`
    : offsetCompare(now, clock.timeZone, baseZone);

  const timeEl = card.querySelector('.clock-time');
  const dateEl = card.querySelector('.clock-date');
  const abbrEl = card.querySelector('.clock-abbr');
  const badgeEl = card.querySelector('.clock-tz-badge');
  const offsetEl = card.querySelector('.clock-offset');
  const cityEl = card.querySelector('.clock-city');

  if (timeEl) timeEl.textContent = time;
  if (dateEl) dateEl.textContent = date;
  if (abbrEl) abbrEl.textContent = abbr;
  if (badgeEl) badgeEl.textContent = abbr || '—';
  if (offsetEl) offsetEl.textContent = offset;
  if (cityEl) cityEl.textContent = `${clock.city}${clock.isLocal ? ' · You' : ''}`;

  const nextKey = imageKeyFor(clock, now);
  if (card.dataset.imgKey !== nextKey) {
    const img = card.querySelector('.clock-image');
    if (img) img.src = dailyImageFor(clock, now);
    card.dataset.imgKey = nextKey;
  }
}

export function renderClocks(container, clocks, now = new Date()) {
  if (!container) return;
  const baseZone = localTimeZone();
  const existing = container.querySelectorAll('[data-clock]');
  const ids = clocks.map((c) => `${c.id}:${c.imageQuery || ''}:${c.city}`).join('|');
  const builtFor = container.dataset.clockIds || '';

  if (existing.length === clocks.length && builtFor === ids) {
    clocks.forEach((clock) => {
      const card = container.querySelector(`[data-clock="${clock.id}"]`);
      if (card) updateClockCard(card, clock, now, baseZone);
    });
    return;
  }

  container.dataset.clockIds = ids;
  container.innerHTML = clocks.map((clock) => clockCardHtml(clock, now, baseZone)).join('');
}
