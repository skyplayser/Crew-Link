// Zeitzonen-Baustein für Crew Link – nur mit Intl (RECHERCHE §3, Empfehlung: eigener Baustein statt Bibliothek).
// Alle Zeitpunkte im Programm sind absolut (ms seit 1970). Ortszeit gibt es nur zur Anzeige und bei der Eingabe,
// immer in der Zeitzone der Veranstaltung, nie in der des Geräts.
// Gegengeprüft in den Tests mit temporal-polyfill (Viertelstunde für Viertelstunde 2026–2030).

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export interface LocalParts { y: number; m: number; d: number; h: number; mi: number; s: number; wd: number }

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Ortszeit eines Zeitpunkts in der Zeitzone `tz`. */
export function localParts(ms: number, tz: string): LocalParts {
  const out: LocalParts = { y: 0, m: 0, d: 0, h: 0, mi: 0, s: 0, wd: 0 };
  for (const p of partsFormatter(tz).formatToParts(new Date(ms))) {
    switch (p.type) {
      case "year": out.y = Number(p.value); break;
      case "month": out.m = Number(p.value); break;
      case "day": out.d = Number(p.value); break;
      case "hour": out.h = Number(p.value) % 24; break;
      case "minute": out.mi = Number(p.value); break;
      case "second": out.s = Number(p.value); break;
      case "weekday": out.wd = WD[p.value] ?? 0; break;
    }
  }
  return out;
}

/** Versatz der Ortszeit gegen UTC in Minuten (Berlin: 60 im Winter, 120 im Sommer). */
export function offsetMin(ms: number, tz: string): number {
  const p = localParts(Math.floor(ms / 1000) * 1000, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MIN);
}

export interface FromLocal {
  /** Gewählter Zeitpunkt: bei doppelter Stunde der frühere (oder der spätere mit prefer "late"), bei Lücke nach vorn geschoben. */
  ms: number;
  /** Die Ortszeit gibt es zweimal (Oktober). */
  ambiguous: boolean;
  /** Die Ortszeit gibt es nicht (März); `ms` ist dann wie Temporal „compatible“ nach vorn geschoben. */
  gap: boolean;
  /** Bei doppelter Stunde: der andere Zeitpunkt. */
  other?: number;
}

/**
 * Ortszeit → ms. Probiert die beiden möglichen Versätze (±12 h um die Stelle) und behält, was zurück dieselbe
 * Ortszeit ergibt. 2 Treffer = doppelte Stunde, 0 Treffer = Lücke. Ergebnis wie Temporal mit
 * `disambiguation: "compatible"` (bzw. "later" mit prefer "late").
 */
export function fromLocal(tz: string, y: number, m: number, d: number, h: number, mi: number, s = 0, prefer: "early" | "late" = "early"): FromLocal {
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  const offs = [...new Set([offsetMin(guess - 12 * HOUR, tz), offsetMin(guess, tz), offsetMin(guess + 12 * HOUR, tz)])];
  const hits: number[] = [];
  for (const o of offs) {
    const c = guess - o * MIN;
    const p = localParts(c, tz);
    if (p.y === y && p.m === m && p.d === d && p.h === h && p.mi === mi && p.s === s && !hits.includes(c)) hits.push(c);
  }
  hits.sort((a, b) => a - b);
  if (hits.length >= 2) {
    const early = hits[0]!, late = hits[hits.length - 1]!;
    return prefer === "late" ? { ms: late, ambiguous: true, gap: false, other: early } : { ms: early, ambiguous: true, gap: false, other: late };
  }
  if (hits.length === 1) return { ms: hits[0]!, ambiguous: false, gap: false };
  // Lücke: mit dem Versatz von vorher rechnen → liegt hinter der Lücke (02:30 → 03:30 Sommerzeit)
  const before = offsetMin(guess - 12 * HOUR, tz);
  return { ms: guess - before * MIN, ambiguous: false, gap: true };
}

/** "YYYY-MM-DD" prüfen und zerlegen. */
export function parseDate(date: string): { y: number; m: number; d: number } | null {
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!r) return null;
  const y = Number(r[1]), m = Number(r[2]), d = Number(r[3]);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** Kalenderdatum plus n Tage (rein im Kalender, ohne Zeitzone). */
export function addDays(date: string, n: number): string {
  const p = parseDate(date);
  if (!p) throw new Error(`Datum ungültig: ${date}`);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function isoDate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Abstand zweier Kalenderdaten in Tagen. */
export function daysBetween(a: string, b: string): number {
  const pa = parseDate(a), pb = parseDate(b);
  if (!pa || !pb) return 0;
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / DAY);
}

/** Kalenderdatum der Ortszeit. */
export function localDate(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return isoDate(p.y, p.m, p.d);
}

/** „HH:MM“ ↔ Minuten seit Mitternacht. */
export function parseHM(hm: string): number | null {
  const r = /^\s*(\d{1,2})[:.]?(\d{2})\s*$/.exec(hm);
  if (!r) return null;
  const h = Number(r[1]), mi = Number(r[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}
export function fmtHM(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Ortszeit „HH:MM“ eines Zeitpunkts. */
export function localHM(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
}
/** Ortszeit „HH:MM:SS“. */
export function localHMS(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}:${String(p.s).padStart(2, "0")}`;
}
/** Minuten seit Mitternacht in Ortszeit. */
export function localMinutes(ms: number, tz: string): number {
  const p = localParts(ms, tz);
  return p.h * 60 + p.mi;
}

/**
 * Betriebstag (Kalenderdatum) eines Zeitpunkts: vor dem Tageswechsel (ab Werk 08:00) gehört er zum Vortag.
 * Sa 02:00 ist also Teil von „Freitag“.
 */
export function businessDate(ms: number, tz: string, dayChangeMin: number): string {
  const p = localParts(ms, tz);
  const date = isoDate(p.y, p.m, p.d);
  return p.h * 60 + p.mi < dayChangeMin ? addDays(date, -1) : date;
}

/**
 * Uhrzeit „HH:MM“ im Betriebstag `date` → Zeitpunkt. Uhrzeit ≥ Tageswechsel → Datum D, sonst D+1 (nach Mitternacht).
 * Tag kopieren und Vorlagen rechnen immer so neu um, nie mit +24 h.
 */
export function dayTime(tz: string, date: string, minutes: number, dayChangeMin: number, prefer: "early" | "late" = "early"): FromLocal {
  const d = minutes >= dayChangeMin ? date : addDays(date, 1);
  const p = parseDate(d)!;
  return fromLocal(tz, p.y, p.m, p.d, Math.floor(minutes / 60), minutes % 60, 0, prefer);
}

/** Wechselt der Versatz zwischen a und b? Dann liegt eine Zeitumstellung dazwischen (Vorzeichen: +60 = vor, −60 = zurück). */
export function dstShiftBetween(a: number, b: number, tz: string): number {
  return offsetMin(b, tz) - offsetMin(a, tz);
}

/** Zeitpunkt der Umstellung zwischen a und b (auf die Minute genau), oder null. */
export function dstTransition(a: number, b: number, tz: string): number | null {
  if (offsetMin(a, tz) === offsetMin(b, tz)) return null;
  let lo = a, hi = b;
  while (hi - lo > MIN) {
    const mid = Math.floor((lo + hi) / 2 / MIN) * MIN;
    if (mid <= lo || mid >= hi) break;
    if (offsetMin(mid, tz) === offsetMin(a, tz)) lo = mid; else hi = mid;
  }
  return hi;
}

/** Wochentag-Kürzel und Datum „Sa 15.11.“ bzw. „Sat 11/15“ – Ortszeit des Datums (ohne Uhrzeit). */
export function dayShort(date: string, lang: "de" | "en"): string {
  const p = parseDate(date);
  if (!p) return date;
  const wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  const de = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"], en = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return lang === "de" ? `${de[wd]} ${String(p.d).padStart(2, "0")}.${String(p.m).padStart(2, "0")}.` : `${en[wd]} ${String(p.m).padStart(2, "0")}/${String(p.d).padStart(2, "0")}`;
}
/** Wochentag-Kürzel eines Zeitpunkts in Ortszeit. */
export function weekdayShort(ms: number, tz: string, lang: "de" | "en"): string {
  const wd = localParts(ms, tz).wd;
  return (lang === "de" ? ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"])[wd]!;
}

/** Läuft die Umgebung mit voller ICU und kennt die Zeitzone? */
export function validTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}
