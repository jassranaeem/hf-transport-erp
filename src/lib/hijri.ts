/**
 * Tabular (civil) Islamic calendar <-> Gregorian conversion, via Julian Day
 * Number. This is a calculated estimate — Ramadan's real start in Pakistan is
 * confirmed by local moon-sighting (Ruet-e-Hilal) and can land a day earlier
 * or later than this table. Verified against two well-documented anchors:
 * 1 Ramadan 1445 AH = 11 Mar 2024, 1 Ramadan 1446 AH = 1 Mar 2025 — both match.
 */
const ISLAMIC_EPOCH = 1948440;

function gregorianToJDN(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12);
  const y2 = y + 4800 - a;
  const m2 = m + 12 * a - 3;
  return d + Math.floor((153 * m2 + 2) / 5) + 365 * y2 + Math.floor(y2 / 4) - Math.floor(y2 / 100) + Math.floor(y2 / 400) - 32045;
}
function jdnToGregorian(jdn: number): { year: number; month: number; day: number } {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d2 = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d2) / 4);
  const m2 = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m2 + 2) / 5) + 1;
  const month = m2 + 3 - 12 * Math.floor(m2 / 10);
  const year = 100 * b + d2 - 4800 + Math.floor(m2 / 10);
  return { year, month, day };
}
function islamicToJDN(year: number, month: number, day: number): number {
  return day + Math.ceil(29.5 * (month - 1)) + (year - 1) * 354 + Math.floor((3 + 11 * year) / 30) + ISLAMIC_EPOCH - 1;
}
function jdnToIslamic(jdn: number): { year: number; month: number; day: number } {
  const year = Math.floor((30 * (jdn - ISLAMIC_EPOCH) + 10646) / 10631);
  let month = Math.min(12, Math.ceil((jdn - (29 + islamicToJDN(year, 1, 1))) / 29.5) + 1);
  if (month < 1) month = 1;
  const day = jdn - islamicToJDN(year, month, 1) + 1;
  return { year, month, day };
}

export function gregorianToIslamic(y: number, m: number, d: number) {
  return jdnToIslamic(gregorianToJDN(y, m, d));
}
export function islamicToGregorian(y: number, m: number, d: number) {
  const g = jdnToGregorian(islamicToJDN(y, m, d));
  return new Date(Date.UTC(g.year, g.month - 1, g.day));
}

/** The 1-Ramadan date that falls inside the given Gregorian calendar year. */
export function ramadanStartInGregorianYear(gregorianYear: number): Date {
  const approxHijriYear = gregorianToIslamic(gregorianYear, 7, 1).year; // mid-year anchor, avoids Jan/Dec edge cases
  for (const hy of [approxHijriYear, approxHijriYear - 1, approxHijriYear + 1]) {
    const d = islamicToGregorian(hy, 9, 1);
    if (d.getUTCFullYear() === gregorianYear) return d;
  }
  // Fallback: shouldn't happen, but return the closest candidate.
  return islamicToGregorian(approxHijriYear, 9, 1);
}
