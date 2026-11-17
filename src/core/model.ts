// Datenmodell von Crew Link (Konzept 0.3, „Begriffe und Datenmodell“): Veranstaltung → Tage, Floors (mit Bühnen),
// Slots, Rollen, Einstellungen, Zustimmungen. Mehrere Tage gehören von Anfang an dazu.
// Alle Zeitpunkte sind absolut (ms seit 1970); die Zeitzone der Veranstaltung gilt für Anzeige und Eingabe.
// Ohne Electron und ohne Netz – voll getestet (tests/model.test.ts).
import { t } from "./i18n";
import { addDays, businessDate, dayTime, fmtHM, localMinutes, parseDate, parseHM, validTimeZone } from "./zeit";

export const FORMAT = "crew-link-event";
export const TEMPLATE_FORMAT = "crew-link-template";
export const FORMAT_VERSION = 1;
export const FILE_EXT = "crewlink";
export const TEMPLATE_EXT = "crewlink-vorlage";
export const DEFAULT_TZ = "Europe/Berlin";
export const DEFAULT_DAY_CHANGE = 8 * 60; // 08:00
export const MAX_FLOORS = 12;
export const MAX_DAYS = 31;
export const MAX_SLOTS = 2000;
export const MAX_NAME = 48;       // Slot-Namen (wie suite-crew)
export const MAX_FLOOR_NAME = 24; // Floor-Namen (wie suite-crew)
export const MAX_NOTE = 500;
export const MAX_EVENT_NAME = 80;
/** Höchstens so groß darf eine .crewlink-Datei sein (Schutz beim Öffnen). */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
/** Zeitpunkte nur zwischen 1970 und 2100 (wie im Suite-Chat). */
export const MAX_AT = 4_102_444_800_000;

export type SlotKind = "dj" | "live" | "b2b" | "changeover" | "break";
export const SLOT_KINDS: SlotKind[] = ["dj", "live", "b2b", "changeover", "break"];
export type Role = "lead" | "booth" | "dj" | "tech" | "security" | "bar";
export const ROLES: Role[] = ["lead", "booth", "dj", "tech", "security", "bar"];
/** Pfad-Namen der Rollen im Browser (/r/<pfad>), wie im Konzept. */
export const ROLE_PATH: Record<Role, string> = { lead: "leitung", booth: "booth", dj: "dj", tech: "technik", security: "security", bar: "bar" };
export type ChatMode = "never" | "notices" | "read" | "write";
export const CHAT_DEFAULT: Record<Role, ChatMode> = { lead: "write", booth: "write", dj: "notices", tech: "write", security: "notices", bar: "notices" };
/** Rollen mit PIN (Phase 2; Datenmodell schon jetzt). Security: PIN nur für EMERGENCY. */
export const PIN_ROLES: Role[] = ["lead", "booth", "security"];

export interface Stage { id: string; name: string }
export interface Floor { id: string; name: string; /** Index 0… in die Floor-Farben (Cyan, Lila, Grün, Gelb, Rot) */ color: number; stages: Stage[] }
export interface DayFloor { open: boolean; /** Floor-Ende (Musik endet auf diesem Floor), absolut */ end?: number }
export interface Day {
  id: string;
  /** Betriebstag (Kalenderdatum der Nacht), „2026-11-14“ = Fr 22:00 bis Sa 06:00 */
  date: string;
  label: string;
  start: number;
  end: number;
  curfew: number | null;
  floors: Record<string, DayFloor>;
}
export interface Slot {
  id: string;
  day: string;
  floor: string;
  stage?: string;
  name: string;
  /** Öffentlicher Name; leer = derselbe wie intern */
  public: string;
  kind: SlotKind;
  start: number;
  end: number;
  note: string;
  /** „Bereit“ gemeldet (Phase 3) */
  readyAt?: number;
  /** Übergabe bestätigt: tatsächlicher Beginn (nur bei Übergabe „bestätigen“); getrennt vom geplanten Beginn */
  handover?: number;
  /** Wartet auf die Übergabe vom vorigen Slot, auch wenn er wegen „Nächsten kürzen“/„Alles verschieben“ später beginnt */
  waitHandover?: boolean;
  /** Zeit fiel beim Kopieren bzw. aus der Vorlage in die fehlende Stunde (Zeitumstellung) und wurde verschoben – bitte prüfen */
  dstMoved?: boolean;
}
export interface Consent { save: boolean; log: boolean; at: number }
export interface RoleSettings {
  /** Sechsstellige PINs im Klartext (Konzept/RECHERCHE §5 Weg A: anzeigen und drucken). Prüfen ab Phase 2. */
  pins: Partial<Record<Role, string>>;
  chatPin: string;
  chat: Record<Role, ChatMode>;
}
export interface Signals {
  entryStopMin: number;  // −60
  lastRoundMin: number;  // −30
  curfewWarnMin: number; // −15
  curfewLastMin: number; // −5
  nextDjMin: number;     // −10 (Übergabe-Fenster)
  setEndMin: number;     // −5
  overMin: number;       // +2
  prepMin: number;       // −30 („Du spielst in 30 min“)
  houselight: "manual" | "auto";
  chatOnChange: boolean;
}
export const DEFAULT_SIGNALS: Signals = {
  entryStopMin: 60, lastRoundMin: 30, curfewWarnMin: 15, curfewLastMin: 5, nextDjMin: 10, setEndMin: 5, overMin: 2, prepMin: 30,
  houselight: "manual", chatOnChange: false,
};
export interface EventSettings {
  /** „plan“: der nächste Slot beginnt zur geplanten Zeit. „confirm“: er beginnt erst mit der Übergabe (sonst überzogen). */
  handover: "plan" | "confirm";
  /** Weboberfläche für diese Veranstaltung (ab Werk aus) und Port (ab Werk 8070, nur von Hand änderbar). */
  web: { on: boolean; port: number };
  timeSource: "system";
}
export interface CrewEvent {
  format: typeof FORMAT;
  version: number;
  /** [0-9a-z]{8,32} (suite-crew `event`) */
  id: string;
  name: string;
  place: string;
  tz: string;
  /** Tageswechsel in Minuten nach Mitternacht (ab Werk 480 = 08:00) */
  dayChange: number;
  days: Day[];
  floors: Floor[];
  slots: Slot[];
  roles: RoleSettings;
  signals: Signals;
  settings: EventSettings;
  consent: Consent;
  /** Demo: wird nie gespeichert */
  demo?: boolean;
}

// ------------------------------------------------------------------ Kennungen, PINs

/** Zufällige Kennung aus [0-9a-z]. */
export function newId(len = 10): string {
  const r = new Uint8Array(len);
  globalThis.crypto.getRandomValues(r);
  let s = "";
  for (const b of r) s += (b % 36).toString(36);
  return s;
}

const WEAK_PINS = new Set(["000000", "111111", "123456", "654321", "123123", "121212", "112233", "999999"]);
/** Sechsstellige PIN, keine offensichtlich schwache (RECHERCHE §5). */
export function newPin(): string {
  for (;;) {
    const r = new Uint32Array(1);
    globalThis.crypto.getRandomValues(r);
    const pin = String(r[0]! % 1_000_000).padStart(6, "0");
    if (!WEAK_PINS.has(pin) && !/^(\d)\1{5}$/.test(pin)) return pin;
  }
}

// ------------------------------------------------------------------ Anlegen

export interface DayInput { date: string; label: string; start: string; end: string; curfew: string }

/** Tag aus Ortszeiten („22:00“, „06:00“) anlegen: Uhrzeiten vor dem Tageswechsel liegen nach Mitternacht. */
/** Fehler beim Anlegen eines Tages: Uhrzeit in der fehlenden Stunde (Zeitumstellung). `value` = „HH:MM“. */
export class GapError extends Error {
  constructor(readonly value: string, readonly date: string) { super(`gap ${value}`); }
}

/**
 * Tag aus Ortszeiten anlegen. Eine Uhrzeit in der fehlenden Stunde (März) wird abgelehnt (GapError), nie still
 * verschoben – außer mit `allowGap` (Vorlagen: dann wie Temporal „compatible“ dahinter).
 */
export function makeDay(ev: Pick<CrewEvent, "tz" | "dayChange" | "floors">, inp: DayInput, id = "d" + newId(8), o: { allowGap?: boolean } = {}): Day {
  if (!parseDate(inp.date)) throw new Error("date");
  const s = parseHM(inp.start), e = parseHM(inp.end), c = inp.curfew.trim() ? parseHM(inp.curfew) : null;
  if (s === null || e === null || (inp.curfew.trim() && c === null)) throw new Error("time");
  const at = (m: number, label: string, date = inp.date) => {
    const r = dayTime(ev.tz, date, m, ev.dayChange);
    if (r.gap && !o.allowGap) throw new GapError(label, m >= ev.dayChange ? date : addDays(date, 1));
    return r.ms;
  };
  const start = at(s, inp.start.trim());
  let end = at(e, inp.end.trim());
  if (end <= start) end = at(e, inp.end.trim(), addDays(inp.date, 1)); // z. B. Tageswechsel spät gewählt
  const curfew = c === null ? null : at(c, inp.curfew.trim());
  const floors: Record<string, DayFloor> = {};
  for (const f of ev.floors) floors[f.id] = { open: true };
  return { id, date: inp.date, label: inp.label.trim().slice(0, 40), start, end, curfew, floors };
}

export function makeFloor(name: string, index: number, id = "f" + newId(8)): Floor {
  return { id, name: name.trim().slice(0, MAX_FLOOR_NAME) || `Floor ${index + 1}`, color: index % 5, stages: [] };
}

export function newEvent(o: { name: string; place?: string; tz?: string; dayChange?: number; days: DayInput[]; floors: string[]; consent: { save: boolean; log: boolean }; now: number }): CrewEvent {
  const tz = o.tz && validTimeZone(o.tz) ? o.tz : DEFAULT_TZ;
  const ev: CrewEvent = {
    format: FORMAT, version: FORMAT_VERSION, id: newId(12),
    name: o.name.trim().slice(0, MAX_EVENT_NAME), place: (o.place ?? "").trim().slice(0, MAX_EVENT_NAME),
    tz, dayChange: o.dayChange ?? DEFAULT_DAY_CHANGE,
    days: [], floors: [], slots: [],
    roles: { pins: { lead: newPin(), booth: newPin(), security: newPin() }, chatPin: newPin(), chat: { ...CHAT_DEFAULT } },
    signals: { ...DEFAULT_SIGNALS },
    settings: { handover: "plan", web: { on: false, port: 8070 }, timeSource: "system" },
    consent: { save: o.consent.save, log: o.consent.log, at: o.now },
  };
  ev.floors = o.floors.map((n, i) => makeFloor(n, i));
  for (const d of o.days) ev.days.push(makeDay(ev, d));
  sortDays(ev);
  return ev;
}

export function sortDays(ev: CrewEvent): void { ev.days.sort((a, b) => a.start - b.start); }
export function sortSlots(slots: Slot[]): Slot[] { return slots.sort((a, b) => a.start - b.start || a.end - b.end); }

/** Öffentlicher Name (leer = intern). */
export function publicName(s: Pick<Slot, "name" | "public">): string { return s.public.trim() || s.name; }

export function slotsOf(ev: CrewEvent, dayId: string, floorId?: string): Slot[] {
  return sortSlots(ev.slots.filter(s => s.day === dayId && (!floorId || s.floor === floorId)));
}
export function dayById(ev: CrewEvent, id: string): Day | undefined { return ev.days.find(d => d.id === id); }
export function floorById(ev: CrewEvent, id: string): Floor | undefined { return ev.floors.find(f => f.id === id); }
export function floorOpen(day: Day, floorId: string): boolean { return day.floors[floorId]?.open !== false; }
/** Ende der Musik auf dem Floor an diesem Tag: eigenes Floor-Ende, sonst Sperrstunde, sonst Betriebsende. */
export function floorEndOf(day: Day, floorId: string): number { return day.floors[floorId]?.end ?? day.curfew ?? day.end; }

/** Zu welchem Tag gehört ein Zeitpunkt? Betriebstag nach Tageswechsel (Sa 02:00 → Freitag). */
export function dayForTime(ev: CrewEvent, ms: number): Day | undefined {
  const date = businessDate(ms, ev.tz, ev.dayChange);
  return ev.days.find(d => d.date === date);
}

/** Ortszeit „HH:MM“ im Tag → Zeitpunkt (Tageswechsel-Regel). */
export function timeInDay(ev: CrewEvent, day: Day, hm: string, prefer: "early" | "late" = "early") {
  const m = parseHM(hm);
  if (m === null) return null;
  return dayTime(ev.tz, day.date, m, ev.dayChange, prefer);
}

// ------------------------------------------------------------------ Tag kopieren, Vorlagen

/** Tag kopieren: Floors, Floor-Enden und Slot-Raster ohne Namen, auf das Datum `date` (Ortszeiten neu umgerechnet). */
export function copyDay(ev: CrewEvent, dayId: string, date: string, label: string): { day: Day; slots: Slot[] } {
  const src = dayById(ev, dayId);
  if (!src) throw new Error("day");
  // gleiche Ortszeit im neuen Betriebstag (nicht +n·24 h: sonst stünde nach einer Zeitumstellung alles 1 h daneben)
  const at = (ms: number) => { const off = dayOffsetOf(ev, src, ms); const d = off ? addDays(date, off) : date; return dayTime(ev.tz, d, localMinutes(ms, ev.tz), ev.dayChange).ms; };
  const id = "d" + newId(8);
  const floors: Record<string, DayFloor> = {};
  for (const [fid, f] of Object.entries(src.floors)) floors[fid] = { open: f.open, ...(f.end !== undefined ? { end: at(f.end) } : {}) };
  const day: Day = { id, date, label, start: at(src.start), end: at(src.end), curfew: src.curfew === null ? null : at(src.curfew), floors };
  // Slots: gleiche Ortszeiten. Fällt Beginn oder Ende in die fehlende Stunde (März) oder in die doppelte Stunde
  // (Oktober): Beginn auf die erste gültige bzw. erste der beiden Zeiten, die echte Länge bleibt gleich, und der Slot
  // bekommt dstMoved (gelbe Prüf-Karte) – nie still verwerfen oder still verlängern.
  const atR = (ms: number) => { const off = dayOffsetOf(ev, src, ms); const d = off ? addDays(date, off) : date; return dayTime(ev.tz, d, localMinutes(ms, ev.tz), ev.dayChange); };
  const slots: Slot[] = slotsOf(ev, dayId).map(s => {
    const a = atR(s.start), b = atR(s.end);
    const moved = a.gap || b.gap || a.ambiguous || b.ambiguous || b.ms <= a.ms;
    return {
      id: "s" + newId(8), day: id, floor: s.floor, ...(s.stage ? { stage: s.stage } : {}), name: "", public: "", kind: s.kind,
      start: a.ms, end: moved ? a.ms + (s.end - s.start) : b.ms, note: "", ...(moved ? { dstMoved: true } : {}),
    };
  });
  return { day, slots };
}

/** Wie viele Betriebstage liegt ms hinter dem Betriebstag (0 normal; 1 bei sehr langen Tagen). */
function dayOffsetOf(ev: CrewEvent, day: Day, ms: number): number {
  const bd = businessDate(ms, ev.tz, ev.dayChange);
  const a = parseDate(day.date)!, b = parseDate(bd)!;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

export interface TemplateDay { offset: number; label: string; start: string; end: string; curfew: string; floors: Record<string, { open: boolean; end?: string }> }
export interface TemplateSlot { day: number; floor: string; kind: SlotKind; start: string; end: string; startOff: number; endOff: number }
export interface CrewTemplate {
  format: typeof TEMPLATE_FORMAT;
  version: number;
  name: string;
  tz: string;
  dayChange: number;
  floors: { id: string; name: string; color: number; stages: Stage[] }[];
  days: TemplateDay[];
  slots: TemplateSlot[];
  signals: Signals;
  handover: "plan" | "confirm";
}

/** Veranstaltung als Vorlage: Tage relativ („Tag 1–3“), Floors, Hinweise, Sperrstunden, Raster – ohne Namen, Notizen, PINs. */
export function toTemplate(ev: CrewEvent, name: string): CrewTemplate {
  const first = ev.days[0]?.date ?? "2026-01-01";
  const rel = (date: string) => { const a = parseDate(first)!, b = parseDate(date)!; return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000); };
  const hm = (ms: number) => fmtHM(localMinutes(ms, ev.tz));
  const dayIdx = new Map(ev.days.map((d, i) => [d.id, i]));
  return {
    format: TEMPLATE_FORMAT, version: FORMAT_VERSION, name: name.trim().slice(0, MAX_EVENT_NAME), tz: ev.tz, dayChange: ev.dayChange,
    floors: ev.floors.map(f => ({ id: f.id, name: f.name, color: f.color, stages: f.stages.map(s => ({ ...s })) })),
    days: ev.days.map(d => ({
      offset: rel(d.date), label: d.label, start: hm(d.start), end: hm(d.end), curfew: d.curfew === null ? "" : hm(d.curfew),
      floors: Object.fromEntries(Object.entries(d.floors).map(([k, f]) => [k, { open: f.open, ...(f.end !== undefined ? { end: hm(f.end) } : {}) }])),
    })),
    slots: ev.slots.filter(s => dayIdx.has(s.day)).map(s => {
      const d = dayById(ev, s.day)!;
      return { day: dayIdx.get(s.day)!, floor: s.floor, kind: s.kind, start: hm(s.start), end: hm(s.end), startOff: dayOffsetOf(ev, d, s.start), endOff: dayOffsetOf(ev, d, s.end) };
    }),
    signals: { ...ev.signals }, handover: ev.settings.handover,
  };
}

/** Vorlage → neue Veranstaltung ab Datum `firstDate`. Ortszeiten werden je Tag neu umgerechnet (Zeitumstellung!). */
export function fromTemplate(t: CrewTemplate, o: { name: string; firstDate: string; consent: { save: boolean; log: boolean }; now: number }): CrewEvent {
  const ev = newEvent({ name: o.name, tz: t.tz, dayChange: t.dayChange, days: [], floors: [], consent: o.consent, now: o.now });
  ev.floors = t.floors.map((f, i) => ({ id: f.id, name: f.name, color: f.color ?? i % 5, stages: (f.stages ?? []).map(s => ({ ...s })) }));
  ev.signals = { ...DEFAULT_SIGNALS, ...t.signals };
  ev.settings.handover = t.handover === "confirm" ? "confirm" : "plan";
  const ids: string[] = [];
  for (const td of t.days) {
    const date = addDays(o.firstDate, td.offset);
    const day = makeDay(ev, { date, label: td.label, start: td.start, end: td.end, curfew: td.curfew }, undefined, { allowGap: true });
    for (const [fid, f] of Object.entries(td.floors)) {
      if (!ev.floors.some(x => x.id === fid)) continue;
      const end = f.end ? timeInDay(ev, day, f.end)?.ms : undefined;
      day.floors[fid] = { open: f.open, ...(end !== undefined ? { end } : {}) };
    }
    ev.days.push(day); ids.push(day.id);
  }
  for (const ts of t.slots) {
    const dayId = ids[ts.day];
    const day = dayId ? dayById(ev, dayId) : undefined;
    if (!day || !ev.floors.some(f => f.id === ts.floor)) continue;
    const sm = parseHM(ts.start), em = parseHM(ts.end);
    if (sm === null || em === null) continue;
    const a = dayTime(ev.tz, addDays(day.date, ts.startOff ?? 0), sm, ev.dayChange);
    const b = dayTime(ev.tz, addDays(day.date, ts.endOff ?? 0), em, ev.dayChange);
    // Länge laut Vorlage (Ortszeit-Differenz). Fällt eine Zeit in die fehlende Stunde: Länge bleibt, Prüf-Karte.
    const rel = (m: number, off: number) => ((m - ev.dayChange + 1440) % 1440) + off * 1440;
    const len = (rel(em, ts.endOff ?? 0) - rel(sm, ts.startOff ?? 0)) * 60_000;
    const moved = a.gap || b.gap || a.ambiguous || b.ambiguous || b.ms <= a.ms;
    if (len <= 0 && moved) continue;
    ev.slots.push({ id: "s" + newId(8), day: day.id, floor: ts.floor, name: "", public: "", kind: ts.kind, start: a.ms, end: moved ? a.ms + len : b.ms, note: "", ...(moved ? { dstMoved: true } : {}) });
  }
  sortDays(ev);
  return ev;
}

// ------------------------------------------------------------------ Datei lesen und prüfen

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_AT;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const idOk = (v: unknown): v is string => typeof v === "string" && /^[0-9a-z_-]{1,40}$/i.test(v);

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** .crewlink lesen. Prüft Format, Version, Typen und Wertebereiche; Unbekanntes fällt weg. */
export function parseEvent(text: string): ParseResult<CrewEvent> {
  if (typeof text !== "string" || text.length > MAX_FILE_BYTES) return { ok: false, error: "size" };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: "json" }; }
  return eventFromObject(raw);
}

export function eventFromObject(raw: unknown): ParseResult<CrewEvent> {
  if (!isObj(raw) || raw.format !== FORMAT) return { ok: false, error: "format" };
  if (typeof raw.version !== "number" || raw.version < 1) return { ok: false, error: "version" };
  if (raw.version > FORMAT_VERSION) return { ok: false, error: "newer" };
  const tz = typeof raw.tz === "string" && validTimeZone(raw.tz) ? raw.tz : DEFAULT_TZ;
  const floors: Floor[] = [];
  for (const f of Array.isArray(raw.floors) ? raw.floors : []) {
    if (!isObj(f) || !idOk(f.id) || floors.some(x => x.id === f.id) || floors.length >= MAX_FLOORS) continue;
    const stages: Stage[] = [];
    for (const s of Array.isArray(f.stages) ? f.stages : []) if (isObj(s) && idOk(s.id)) stages.push({ id: s.id, name: str(s.name, MAX_FLOOR_NAME) });
    floors.push({ id: f.id, name: str(f.name, MAX_FLOOR_NAME) || "Floor", color: typeof f.color === "number" && f.color >= 0 && f.color < 5 ? Math.floor(f.color) : floors.length % 5, stages });
  }
  const days: Day[] = [];
  for (const d of Array.isArray(raw.days) ? raw.days : []) {
    if (!isObj(d) || !idOk(d.id) || days.some(x => x.id === d.id) || days.length >= MAX_DAYS) continue;
    if (typeof d.date !== "string" || !parseDate(d.date) || !isTime(d.start) || !isTime(d.end) || d.end <= d.start) continue;
    const df: Record<string, DayFloor> = {};
    if (isObj(d.floors)) for (const [k, v] of Object.entries(d.floors)) {
      if (!floors.some(f => f.id === k) || !isObj(v)) continue;
      df[k] = { open: v.open !== false, ...(isTime(v.end) ? { end: v.end } : {}) };
    }
    days.push({ id: d.id, date: d.date, label: str(d.label, 40), start: d.start, end: d.end, curfew: isTime(d.curfew) ? d.curfew : null, floors: df });
  }
  days.sort((a, b) => a.start - b.start);
  const slots: Slot[] = [];
  for (const s of Array.isArray(raw.slots) ? raw.slots : []) {
    if (slots.length >= MAX_SLOTS) break;
    if (!isObj(s) || !idOk(s.id) || slots.some(x => x.id === s.id)) continue;
    if (typeof s.day !== "string" || !days.some(d => d.id === s.day) || typeof s.floor !== "string" || !floors.some(f => f.id === s.floor)) continue;
    if (!isTime(s.start) || !isTime(s.end) || s.end <= s.start) continue;
    const kind = SLOT_KINDS.includes(s.kind as SlotKind) ? (s.kind as SlotKind) : "dj";
    const floor = floors.find(f => f.id === s.floor)!;
    slots.push({
      id: s.id, day: s.day, floor: s.floor, ...(typeof s.stage === "string" && floor.stages.some(x => x.id === s.stage) ? { stage: s.stage } : {}),
      name: str(s.name, MAX_NAME), public: str(s.public, MAX_NAME), kind, start: s.start, end: s.end, note: str(s.note, MAX_NOTE),
      ...(isTime(s.readyAt) ? { readyAt: s.readyAt } : {}), ...(isTime(s.handover) ? { handover: s.handover } : {}),
      ...(s.waitHandover === true ? { waitHandover: true } : {}), ...(s.dstMoved === true ? { dstMoved: true } : {}),
    });
  }
  const r = isObj(raw.roles) ? raw.roles : {};
  const pins: Partial<Record<Role, string>> = {};
  if (isObj(r.pins)) for (const role of ROLES) { const p = r.pins[role]; if (typeof p === "string" && /^\d{6}$/.test(p)) pins[role] = p; }
  const chat = { ...CHAT_DEFAULT };
  if (isObj(r.chat)) for (const role of ROLES) { const c = r.chat[role]; if (c === "never" || c === "notices" || c === "read" || c === "write") chat[role] = c; }
  const sig = { ...DEFAULT_SIGNALS };
  if (isObj(raw.signals)) for (const k of Object.keys(DEFAULT_SIGNALS) as (keyof Signals)[]) {
    const v = raw.signals[k];
    if (k === "houselight") { if (v === "manual" || v === "auto") sig.houselight = v; }
    else if (k === "chatOnChange") { if (typeof v === "boolean") sig.chatOnChange = v; }
    else if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 240) (sig as unknown as Record<string, number>)[k] = Math.round(v);
  }
  const st = isObj(raw.settings) ? raw.settings : {};
  const web = isObj(st.web) ? st.web : {};
  const c = isObj(raw.consent) ? raw.consent : {};
  const dc = typeof raw.dayChange === "number" && raw.dayChange >= 0 && raw.dayChange < 1440 ? Math.round(raw.dayChange) : DEFAULT_DAY_CHANGE;
  return {
    ok: true,
    value: {
      format: FORMAT, version: FORMAT_VERSION,
      id: typeof raw.id === "string" && /^[0-9a-z]{8,32}$/.test(raw.id) ? raw.id : newId(12),
      name: str(raw.name, MAX_EVENT_NAME), place: str(raw.place, MAX_EVENT_NAME), tz, dayChange: dc,
      days, floors, slots,
      roles: { pins, chatPin: typeof r.chatPin === "string" && /^\d{6}$/.test(r.chatPin) ? r.chatPin : newPin(), chat },
      signals: sig,
      settings: {
        handover: st.handover === "confirm" ? "confirm" : "plan",
        web: { on: web.on === true, port: typeof web.port === "number" && web.port >= 1024 && web.port <= 65535 ? Math.floor(web.port) : 8070 },
        timeSource: "system",
      },
      consent: { save: c.save === true, log: c.log === true, at: isTime(c.at) ? c.at : 0 },
      ...(raw.demo === true ? { demo: true } : {}),
    },
  };
}

export function serializeEvent(ev: CrewEvent): string {
  return JSON.stringify(ev, null, 1);
}

export function parseTemplate(text: string): ParseResult<CrewTemplate> {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: "json" }; }
  if (!isObj(raw) || raw.format !== TEMPLATE_FORMAT) return { ok: false, error: "format" };
  if (typeof raw.version !== "number" || raw.version > FORMAT_VERSION) return { ok: false, error: "version" };
  const floors = (Array.isArray(raw.floors) ? raw.floors : []).filter(isObj).filter(f => idOk(f.id)).slice(0, MAX_FLOORS)
    .map((f, i) => ({ id: f.id as string, name: str(f.name, MAX_FLOOR_NAME) || `Floor ${i + 1}`, color: typeof f.color === "number" ? Math.abs(Math.floor(f.color)) % 5 : i % 5, stages: [] as Stage[] }));
  const hmOk = (v: unknown) => typeof v === "string" && parseHM(v) !== null;
  const days = (Array.isArray(raw.days) ? raw.days : []).filter(isObj).slice(0, MAX_DAYS)
    .filter(d => typeof d.offset === "number" && hmOk(d.start) && hmOk(d.end))
    .map(d => ({
      offset: Math.max(0, Math.min(365, Math.floor(d.offset as number))), label: str(d.label, 40), start: d.start as string, end: d.end as string,
      curfew: hmOk(d.curfew) ? (d.curfew as string) : "",
      floors: isObj(d.floors) ? Object.fromEntries(Object.entries(d.floors).filter(([, v]) => isObj(v)).map(([k, v]) => {
        const o = v as Record<string, unknown>; return [k, { open: o.open !== false, ...(hmOk(o.end) ? { end: o.end as string } : {}) }];
      })) : {},
    }));
  const slots = (Array.isArray(raw.slots) ? raw.slots : []).filter(isObj).slice(0, MAX_SLOTS)
    .filter(s => typeof s.day === "number" && typeof s.floor === "string" && hmOk(s.start) && hmOk(s.end))
    .map(s => ({ day: s.day as number, floor: s.floor as string, kind: SLOT_KINDS.includes(s.kind as SlotKind) ? (s.kind as SlotKind) : "dj", start: s.start as string, end: s.end as string,
      startOff: typeof s.startOff === "number" ? Math.max(0, Math.min(2, Math.floor(s.startOff))) : 0, endOff: typeof s.endOff === "number" ? Math.max(0, Math.min(2, Math.floor(s.endOff))) : 0 }));
  return {
    ok: true,
    value: {
      format: TEMPLATE_FORMAT, version: FORMAT_VERSION, name: str(raw.name, MAX_EVENT_NAME),
      tz: typeof raw.tz === "string" && validTimeZone(raw.tz) ? raw.tz : DEFAULT_TZ,
      dayChange: typeof raw.dayChange === "number" && raw.dayChange >= 0 && raw.dayChange < 1440 ? Math.round(raw.dayChange) : DEFAULT_DAY_CHANGE,
      floors, days, slots, signals: { ...DEFAULT_SIGNALS, ...(isObj(raw.signals) ? eventSignals(raw.signals) : {}) },
      handover: raw.handover === "confirm" ? "confirm" : "plan",
    },
  };
}

function eventSignals(s: Record<string, unknown>): Partial<Signals> {
  const out: Partial<Signals> = {};
  for (const k of Object.keys(DEFAULT_SIGNALS) as (keyof Signals)[]) {
    const v = s[k];
    if (k === "houselight") { if (v === "manual" || v === "auto") out.houselight = v; }
    else if (k === "chatOnChange") { if (typeof v === "boolean") out.chatOnChange = v; }
    else if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 240) (out as Record<string, number>)[k] = Math.round(v);
  }
  return out;
}

/** Eingebaute Vorlagen („Jeden Samstag“, „Festival 3 Tage“) – ohne Namen. */
export function builtinTemplates(): CrewTemplate[] {
  const base = { format: TEMPLATE_FORMAT as typeof TEMPLATE_FORMAT, version: FORMAT_VERSION, tz: DEFAULT_TZ, dayChange: DEFAULT_DAY_CHANGE, signals: { ...DEFAULT_SIGNALS }, handover: "plan" as const };
  const club: CrewTemplate = {
    ...base, name: t("tpl.builtin.club"),
    floors: [{ id: "main", name: "Main", color: 0, stages: [] }, { id: "keller", name: t("tpl.floor.second"), color: 1, stages: [] }],
    days: [{ offset: 0, label: t("tpl.day.saturday"), start: "22:00", end: "06:00", curfew: "05:00", floors: { main: { open: true }, keller: { open: true } } }],
    slots: [
      ...["22:00", "00:00", "02:00"].map((s, i) => ({ day: 0, floor: "main", kind: "dj" as SlotKind, start: s, end: ["00:00", "02:00", "05:00"][i]!, startOff: 0, endOff: 0 })),
      ...["23:00", "01:30"].map((s, i) => ({ day: 0, floor: "keller", kind: "dj" as SlotKind, start: s, end: ["01:30", "05:00"][i]!, startOff: 0, endOff: 0 })),
    ],
  };
  const fest: CrewTemplate = {
    ...base, name: t("tpl.builtin.festival"),
    floors: [{ id: "a", name: t("tpl.stage", { x: "A" }), color: 0, stages: [] }, { id: "b", name: t("tpl.stage", { x: "B" }), color: 1, stages: [] }],
    days: [
      { offset: 0, label: t("tpl.dayN", { n: 1 }), start: "14:00", end: "04:00", curfew: "03:00", floors: { a: { open: true }, b: { open: true, end: "01:00" } } },
      { offset: 1, label: t("tpl.dayN", { n: 2 }), start: "12:00", end: "04:00", curfew: "03:00", floors: { a: { open: true }, b: { open: true, end: "01:00" } } },
      { offset: 2, label: t("tpl.dayN", { n: 3 }), start: "12:00", end: "22:00", curfew: "22:00", floors: { a: { open: true }, b: { open: false } } },
    ],
    slots: [],
  };
  return [club, fest];
}

/** Hilfe für Tests und Demo: Ortszeit eines Tages + Tagesverschiebung. */
export function dateOfDay(day: Day): string { return day.date; }
