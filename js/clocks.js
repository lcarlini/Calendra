export const FIXED_CLOCKS = [
  { id: 'chicago', city: 'Chicago', timeZone: 'America/Chicago' },
  { id: 'newyork', city: 'New York', timeZone: 'America/New_York' },
  { id: 'london', city: 'London', timeZone: 'Europe/London' },
  { id: 'amsterdam', city: 'Amsterdam', timeZone: 'Europe/Amsterdam' },
];

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

function offsetLabel(date, timeZone, baseZone) {
  const fmt = (zone) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'shortOffset',
      hour: '2-digit',
    });

  const getOffset = (zone) => {
    const part = fmt(zone).formatToParts(date).find((p) => p.type === 'timeZoneName');
    return part?.value || '';
  };

  const a = getOffset(timeZone);
  const b = getOffset(baseZone);
  if (!a || !b || a === b) return a || 'Local';
  return `${a} · vs you ${b}`;
}

export function buildClockList(localCity = 'Local') {
  const zone = localTimeZone();
  const local = {
    id: 'local',
    city: localCity,
    timeZone: zone,
    isLocal: true,
  };

  const fixed = FIXED_CLOCKS.filter((c) => c.timeZone !== zone);
  return [local, ...fixed];
}

export function renderClocks(container, clocks, now = new Date()) {
  if (!container) return;
  const baseZone = localTimeZone();

  container.innerHTML = clocks
    .map((clock) => {
      const { time, date } = partsFor(now, clock.timeZone);
      const offset = clock.isLocal
        ? clock.timeZone.replace(/_/g, ' ')
        : offsetLabel(now, clock.timeZone, baseZone);

      return `
        <article class="clock-card ${clock.isLocal ? 'local' : ''}" data-clock="${clock.id}">
          <div class="clock-city">${clock.city}${clock.isLocal ? ' · You' : ''}</div>
          <div class="clock-time">${time}</div>
          <div class="clock-date">${date}</div>
          <div class="clock-offset">${offset}</div>
        </article>
      `;
    })
    .join('');
}
