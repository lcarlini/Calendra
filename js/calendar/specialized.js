/**
 * Structured reference calendars transcribed from the supplied files:
 *
 *  - GCM ("GCM Grosvenor United States Holiday Schedule"): UI/Holidays.png,
 *    years 2025–2027, and the GCM rows of UI/Calendar.html (2026).
 *  - Brasil (reference list): UI/Calendar.html (2026 only).
 *  - Davi (personal/organisation schedule): UI/Calendar.html (2026 only).
 *
 * Rules that are NOT applied here:
 *  - No entries are extrapolated to other years. The source files do not
 *    confirm Brasil or Davi dates beyond 2026, and the meaning of "Davi" is
 *    the label used in the source, not something inferred.
 *  - Source weekday labels (`dow`) are kept so tests can check every date.
 *
 * Verification statuses (see CalendarEvent.verificationStatus):
 *  - "verified": transcribed from the named reference file.
 *  - "needs-review": transcribed, but flagged for manual confirmation.
 */

export const SOURCE_HOLIDAYS_PNG = 'UI/Holidays.png';
export const SOURCE_CALENDAR_HTML = 'UI/Calendar.html';

/** Category ids used by the shared calendar domain. */
export const SPECIAL_CATEGORIES = {
  gcm: { id: 'gcm', label: 'GCM', pillLabel: 'GCM', shortLabel: 'G', color: '#4aa3ff', sourceType: 'reference-calendar' },
  brasilRef: { id: 'brasil-ref', label: 'Brasil (ref.)', pillLabel: 'BR ref', shortLabel: 'B', color: '#ff9a3d', sourceType: 'reference-calendar' },
  davi: { id: 'davi', label: 'Davi', pillLabel: 'Davi', shortLabel: 'D', color: '#58c46a', sourceType: 'reference-calendar' },
};

/** GCM US holiday schedule. Source: UI/Holidays.png (2025, 2027) and UI/Calendar.html GCM rows (2026). */
const GCM_ENTRIES = [
  // 2025 — Holidays.png
  { year: 2025, date: '2025-01-01', name: "New Year's Day", dow: 'Wednesday', source: SOURCE_HOLIDAYS_PNG },
  { year: 2025, date: '2025-01-20', name: 'Martin Luther King Day', dow: 'Monday', source: SOURCE_HOLIDAYS_PNG },
  { year: 2025, date: '2025-02-17', name: "Presidents' Day", dow: 'Monday', source: SOURCE_HOLIDAYS_PNG },
  { year: 2025, date: '2025-04-18', name: 'Good Friday', dow: 'Friday', source: SOURCE_HOLIDAYS_PNG },
  { year: 2025, date: '2025-05-26', name: 'Memorial Day', dow: 'Monday', source: SOURCE_HOLIDAYS_PNG },
  { year: 2025, date: '2025-06-19', name: 'Juneteenth', dow: 'Thursday', source: SOURCE_HOLIDAYS_PNG },
  { year: 2025, date: '2025-07-04', name: 'Independence Day', dow: 'Friday', source: SOURCE_HOLIDAYS_PNG },
  { year: 2025, date: '2025-09-01', name: 'Labor Day', dow: 'Monday', source: SOURCE_HOLIDAYS_PNG },
  { year: 2025, date: '2025-11-27', name: 'Thanksgiving Day', dow: 'Thursday', source: SOURCE_HOLIDAYS_PNG },
  { year: 2025, date: '2025-11-28', name: 'Day after Thanksgiving', dow: 'Friday', source: SOURCE_HOLIDAYS_PNG },
  { year: 2025, date: '2025-12-25', name: 'Christmas Day', dow: 'Thursday', source: SOURCE_HOLIDAYS_PNG },
  // 2026 — Calendar.html GCM rows (agrees with Holidays.png 2026 column)
  { year: 2026, date: '2026-01-01', name: "New Year's Day", dow: 'Thursday', source: SOURCE_CALENDAR_HTML },
  { year: 2026, date: '2026-01-19', name: 'Martin Luther King Day', dow: 'Monday', source: SOURCE_CALENDAR_HTML },
  { year: 2026, date: '2026-02-16', name: 'Presidents Day', dow: 'Monday', source: SOURCE_CALENDAR_HTML },
  { year: 2026, date: '2026-04-03', name: 'Good Friday', dow: 'Friday', source: SOURCE_CALENDAR_HTML },
  { year: 2026, date: '2026-05-25', name: 'Memorial Day', dow: 'Monday', source: SOURCE_CALENDAR_HTML },
  { year: 2026, date: '2026-06-19', name: 'Juneteenth', dow: 'Friday', source: SOURCE_CALENDAR_HTML },
  { year: 2026, date: '2026-07-03', name: 'Independence Day (observed)', dow: 'Friday', source: SOURCE_CALENDAR_HTML },
  { year: 2026, date: '2026-09-07', name: 'Labor Day', dow: 'Monday', source: SOURCE_CALENDAR_HTML },
  { year: 2026, date: '2026-11-26', name: 'Thanksgiving Day', dow: 'Thursday', source: SOURCE_CALENDAR_HTML },
  { year: 2026, date: '2026-11-27', name: 'Day after Thanksgiving', dow: 'Friday', source: SOURCE_CALENDAR_HTML },
  { year: 2026, date: '2026-12-25', name: 'Christmas Day', dow: 'Friday', source: SOURCE_CALENDAR_HTML },
  // 2027 — Holidays.png (observed dates shown with *)
  { year: 2027, date: '2027-01-01', name: "New Year's Day", dow: 'Friday', source: SOURCE_HOLIDAYS_PNG },
  { year: 2027, date: '2027-01-18', name: 'Martin Luther King Day', dow: 'Monday', source: SOURCE_HOLIDAYS_PNG },
  { year: 2027, date: '2027-02-15', name: "Presidents' Day", dow: 'Monday', source: SOURCE_HOLIDAYS_PNG },
  { year: 2027, date: '2027-03-26', name: 'Good Friday', dow: 'Friday', source: SOURCE_HOLIDAYS_PNG },
  { year: 2027, date: '2027-05-31', name: 'Memorial Day', dow: 'Monday', source: SOURCE_HOLIDAYS_PNG },
  { year: 2027, date: '2027-06-18', name: 'Juneteenth (observed)', dow: 'Friday', source: SOURCE_HOLIDAYS_PNG },
  { year: 2027, date: '2027-07-05', name: 'Independence Day (observed)', dow: 'Monday', source: SOURCE_HOLIDAYS_PNG },
  { year: 2027, date: '2027-09-06', name: 'Labor Day', dow: 'Monday', source: SOURCE_HOLIDAYS_PNG },
  { year: 2027, date: '2027-11-25', name: 'Thanksgiving Day', dow: 'Thursday', source: SOURCE_HOLIDAYS_PNG },
  { year: 2027, date: '2027-11-26', name: 'Day after Thanksgiving', dow: 'Friday', source: SOURCE_HOLIDAYS_PNG },
  { year: 2027, date: '2027-12-24', name: 'Christmas Day (observed)', dow: 'Friday', source: SOURCE_HOLIDAYS_PNG },
];

/** Brasil reference list. Source: UI/Calendar.html (2026 only). */
const BRASIL_REF_ENTRIES = [
  { year: 2026, date: '2026-01-01', name: 'Confraternização Universal', dow: 'Thursday' },
  { year: 2026, date: '2026-02-16', name: 'Carnaval', dow: 'Monday' },
  { year: 2026, date: '2026-02-17', name: 'Carnaval', dow: 'Tuesday' },
  { year: 2026, date: '2026-04-03', name: 'Paixão de Cristo', dow: 'Friday' },
  { year: 2026, date: '2026-04-21', name: 'Tiradentes', dow: 'Tuesday' },
  { year: 2026, date: '2026-05-01', name: 'Dia do Trabalho', dow: 'Friday' },
  { year: 2026, date: '2026-06-04', name: 'Corpus Christi', dow: 'Thursday' },
  { year: 2026, date: '2026-09-07', name: 'Independência do Brasil', dow: 'Monday' },
  { year: 2026, date: '2026-10-12', name: 'Nossa Senhora Aparecida', dow: 'Monday' },
  { year: 2026, date: '2026-11-02', name: 'Finados', dow: 'Monday' },
  { year: 2026, date: '2026-11-15', name: 'Proclamação da República', dow: 'Sunday' },
  { year: 2026, date: '2026-11-20', name: 'Consciência Negra', dow: 'Friday' },
  { year: 2026, date: '2026-12-25', name: 'Natal', dow: 'Friday' },
];

/**
 * Davi schedule. Source: UI/Calendar.html (2026 only). The source states
 * "sem eventos em sábado/domingo" (no weekend events); tests enforce this.
 * The last four "Recesso" rows were appended after the main block in the
 * source and are marked needs-review.
 */
const DAVI_ENTRIES = [
  { year: 2026, date: '2026-01-01', name: 'Confraternização Universal', dow: 'Thursday' },
  { year: 2026, date: '2026-01-22', name: 'Início das aulas', dow: 'Thursday' },
  { year: 2026, date: '2026-02-16', name: 'Recesso', dow: 'Monday' },
  { year: 2026, date: '2026-02-17', name: 'Carnaval', dow: 'Tuesday' },
  { year: 2026, date: '2026-02-18', name: 'Recesso', dow: 'Wednesday' },
  { year: 2026, date: '2026-04-03', name: 'Sexta-feira Santa', dow: 'Friday' },
  { year: 2026, date: '2026-04-21', name: 'Tiradentes', dow: 'Tuesday' },
  { year: 2026, date: '2026-05-01', name: 'Dia do Trabalho', dow: 'Friday' },
  { year: 2026, date: '2026-05-13', name: 'São Benedito', dow: 'Wednesday' },
  { year: 2026, date: '2026-06-04', name: 'Corpus Christi', dow: 'Thursday' },
  { year: 2026, date: '2026-06-30', name: 'Término do 1º semestre', dow: 'Tuesday' },
  { year: 2026, date: '2026-08-03', name: 'Início do 2º semestre', dow: 'Monday' },
  { year: 2026, date: '2026-09-07', name: 'Independência do Brasil', dow: 'Monday' },
  { year: 2026, date: '2026-10-12', name: 'Nossa Senhora Aparecida', dow: 'Monday' },
  { year: 2026, date: '2026-10-13', name: 'Dia do professor', dow: 'Tuesday' },
  { year: 2026, date: '2026-11-02', name: 'Finados', dow: 'Monday' },
  { year: 2026, date: '2026-11-06', name: 'Aniversário de Poços de Caldas', dow: 'Friday' },
  { year: 2026, date: '2026-11-20', name: 'Consciência Negra', dow: 'Friday' },
  { year: 2026, date: '2026-12-11', name: 'Formatura / Apresentação de fim de ano', dow: 'Friday' },
  { year: 2026, date: '2026-12-15', name: 'Término das aulas', dow: 'Tuesday' },
  { year: 2026, date: '2026-12-25', name: 'Natal', dow: 'Friday' },
  { year: 2026, date: '2026-04-02', name: 'Recesso', dow: 'Thursday', verificationStatus: 'needs-review' },
  { year: 2026, date: '2026-04-20', name: 'Recesso', dow: 'Monday', verificationStatus: 'needs-review' },
  { year: 2026, date: '2026-06-05', name: 'Recesso', dow: 'Friday', verificationStatus: 'needs-review' },
  { year: 2026, date: '2026-10-13', name: 'Recesso', dow: 'Tuesday', verificationStatus: 'needs-review' },
];

const ALL = [
  ...GCM_ENTRIES.map((e) => ({ ...e, category: SPECIAL_CATEGORIES.gcm })),
  ...BRASIL_REF_ENTRIES.map((e) => ({
    ...e,
    source: SOURCE_CALENDAR_HTML,
    category: SPECIAL_CATEGORIES.brasilRef,
  })),
  ...DAVI_ENTRIES.map((e) => ({
    ...e,
    source: SOURCE_CALENDAR_HTML,
    category: SPECIAL_CATEGORIES.davi,
  })),
];

/** All reference entries, with category and source attached. Read-only copy. */
export function allSpecializedEntries() {
  return ALL.map((e) => ({ ...e }));
}

/**
 * Entries for one calendar category and one year. Returns [] for years the
 * source files do not cover, so nothing is fabricated for those years.
 */
export function specializedEntriesForYear(categoryId, year) {
  return ALL.filter((e) => e.category.id === categoryId && e.year === year).map((e) => ({
    ...e,
  }));
}

/** Years the source files confirm for a category (used by the UI to show coverage). */
export function coveredYears(categoryId) {
  return [...new Set(ALL.filter((e) => e.category.id === categoryId).map((e) => e.year))].sort();
}
