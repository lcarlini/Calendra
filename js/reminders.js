import { loadReminders, saveReminders, uid } from './storage.js';

const notified = new Set();

export function getReminders() {
  return loadReminders().sort((a, b) => {
    const da = `${a.date}T${a.time}`;
    const db = `${b.date}T${b.time}`;
    return da.localeCompare(db);
  });
}

export function addReminder(payload) {
  const reminders = loadReminders();
  const item = {
    id: uid(),
    title: payload.title.trim(),
    date: payload.date,
    time: payload.time,
    leadMinutes: Number(payload.leadMinutes) || 5,
    notes: (payload.notes || '').trim(),
    done: false,
    createdAt: new Date().toISOString(),
  };
  reminders.push(item);
  saveReminders(reminders);
  return item;
}

export function updateReminder(id, patch) {
  const reminders = loadReminders().map((r) => (r.id === id ? { ...r, ...patch } : r));
  saveReminders(reminders);
  return reminders;
}

export function deleteReminder(id) {
  const reminders = loadReminders().filter((r) => r.id !== id);
  saveReminders(reminders);
  return reminders;
}

export function remindersForDate(dateStr) {
  return getReminders().filter((r) => r.date === dateStr);
}

export function todayISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatLead(mins) {
  if (mins === 0) return 'At start';
  if (mins < 60) return `${mins} min before`;
  if (mins % 60 === 0) return `${mins / 60} hr before`;
  return `${mins} min before`;
}

function toDate(reminder) {
  return new Date(`${reminder.date}T${reminder.time}:00`);
}

export async function ensureNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function checkDueReminders(onAlert) {
  const now = Date.now();
  const list = getReminders().filter((r) => !r.done);

  for (const reminder of list) {
    const eventAt = toDate(reminder).getTime();
    if (Number.isNaN(eventAt)) continue;

    const alertAt = eventAt - reminder.leadMinutes * 60 * 1000;
    const key = `${reminder.id}:${alertAt}`;

    if (now >= alertAt && now < eventAt + 60 * 1000 && !notified.has(key)) {
      notified.add(key);
      onAlert?.(reminder, eventAt - now);
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`Calendra · ${reminder.title}`, {
          body: `${reminder.time} · ${formatLead(reminder.leadMinutes)}`,
          tag: key,
        });
      }
    }
  }
}
