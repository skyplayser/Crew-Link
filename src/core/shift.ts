// Überziehen und Programmänderung (Konzept „Ein DJ überzieht“, „Programmänderung“):
// „Nächsten kürzen“ und „Alles verschieben“ rechnen nur eine VORSCHAU. Crew Link ändert nie von selbst etwas am Plan –
// erst „Bestätigen“ wendet die Änderungen an (applyChanges).
import { floorEndOf, sortSlots, type CrewEvent, type Slot } from "./model";
import { MIN } from "./zeit";

export interface SlotChange { slot: string; from: { start: number; end: number }; to: { start: number; end: number }; /** wartet auf die Übergabe */ wait?: boolean }
export interface Preview {
  changes: SlotChange[];
  /** Über Sperrstunde bzw. Floor-Ende (Minuten) mit Vorschlag, wo gekürzt wird */
  warn?: { kind: "afterCurfew" | "afterFloorEnd" | "nothingLeft"; minutes: number; slot: string; suggest?: SlotChange };
}

/** Auf die nächste volle Minute aufrunden (Übergaben finden nicht mitten in der Sekunde statt). */
export function ceilMinute(ms: number): number { return Math.ceil(ms / MIN) * MIN; }

function following(ev: CrewEvent, s: Slot): Slot[] {
  return sortSlots(ev.slots.filter(x => x.day === s.day && x.floor === s.floor && (x.stage ?? "") === (s.stage ?? "") && x.id !== s.id && x.start >= s.start));
}

/** Erwartete bzw. bestätigte Übergabe: bestätigt (handover des nächsten), sonst jetzt (volle Minute), frühestens Set-Ende. */
function handoverAt(s: Slot, next: Slot | undefined, now: number): number {
  if (next?.handover !== undefined) return next.handover;
  return Math.max(ceilMinute(now), s.end);
}

/**
 * Nächsten kürzen: Der nächste Slot beginnt später (zur Übergabe), endet aber wie geplant.
 * Übergabe „bestätigen“: Das geplante Ende des überzogenen Slots bleibt (das Überziehen bleibt sichtbar, „+mm:ss“ bis
 * zur Übergabe); nur der nächste Slot ändert sich und wartet auf die Übergabe. Übergabe „nach Plan“: der laufende Slot
 * endet zur selben Zeit (der Plan ist dort die Wahrheit).
 */
export function previewShortenNext(ev: CrewEvent, slotId: string, now: number): Preview {
  const s = ev.slots.find(x => x.id === slotId);
  if (!s) return { changes: [] };
  const confirm = ev.settings.handover === "confirm";
  const next = following(ev, s)[0];
  const at = handoverAt(s, next, now);
  const changes: SlotChange[] = [];
  if (!confirm && at !== s.end) changes.push({ slot: s.id, from: { start: s.start, end: s.end }, to: { start: s.start, end: at } });
  if (!next) return { changes };
  const start = Math.max(next.start, at);
  if (start >= next.end) return { changes, warn: { kind: "nothingLeft", minutes: 0, slot: next.id } };
  if (start !== next.start) changes.push({ slot: next.id, from: { start: next.start, end: next.end }, to: { start, end: next.end }, ...(confirm && next.handover === undefined ? { wait: true } : {}) });
  return { changes };
}

/**
 * Alles verschieben: Alle folgenden Slots des Floors an diesem Tag rücken nach (Beginn des nächsten = Übergabe).
 * Übergabe „bestätigen“: der überzogene Slot behält sein geplantes Ende. „Nach Plan“: er endet zur Übergabe.
 * Warnt, wenn damit Sperrstunde oder Floor-Ende überschritten würden, und schlägt vor, den letzten Slot zu kürzen.
 */
export function previewShiftAll(ev: CrewEvent, slotId: string, now: number): Preview {
  const s = ev.slots.find(x => x.id === slotId);
  if (!s) return { changes: [] };
  const confirm = ev.settings.handover === "confirm";
  const next = following(ev, s)[0];
  const at = handoverAt(s, next, now);
  if (confirm) {
    const delta = at - (next?.start ?? s.end);
    if (!next || delta <= 0) return { changes: [] };
    return shiftFrom(ev, s, delta, "following");
  }
  const delta = at - s.end;
  if (delta <= 0) return { changes: [] };
  return shiftFrom(ev, s, delta, "endOnly");
}

/**
 * Verschiebt alle Slots nach `s` um `delta` ms. `mode`: "endOnly" = Ende von `s` mit, "all" = `s` ganz mit,
 * "following" = `s` bleibt, der nächste wartet auf die Übergabe (Übergabe „bestätigen“).
 */
export function shiftFrom(ev: CrewEvent, s: Slot, delta: number, mode: "endOnly" | "all" | "following"): Preview {
  const changes: SlotChange[] = mode === "following" ? [] : [{ slot: s.id, from: { start: s.start, end: s.end }, to: { start: mode === "endOnly" ? s.start : s.start + delta, end: s.end + delta } }];
  following(ev, s).forEach((x, i) => changes.push({ slot: x.id, from: { start: x.start, end: x.end }, to: { start: x.start + delta, end: x.end + delta },
    ...(mode === "following" && i === 0 && x.handover === undefined ? { wait: true } : {}) }));
  const day = ev.days.find(d => d.id === s.day);
  const last = changes[changes.length - 1];
  if (day && last) {
    const own = day.floors[s.floor]?.end !== undefined;
    const limit = own ? floorEndOf(day, s.floor) : day.curfew;
    if (limit !== null && last.to.end > limit) {
      const minutes = Math.round((last.to.end - limit) / MIN);
      const suggest: SlotChange | undefined = last.to.start < limit ? { slot: last.slot, from: last.to, to: { start: last.to.start, end: limit } } : undefined;
      return { changes, warn: { kind: own ? "afterFloorEnd" : "afterCurfew", minutes, slot: last.slot, ...(suggest ? { suggest } : {}) } };
    }
  }
  return { changes };
}

/** Änderungen anwenden (nach „Bestätigen“). Gibt eine neue Veranstaltung zurück; das Original bleibt unverändert. */
export function applyChanges(ev: CrewEvent, changes: SlotChange[]): CrewEvent {
  const byId = new Map(changes.map(c => [c.slot, c]));
  return { ...ev, slots: ev.slots.map(s => { const c = byId.get(s.id); return c ? { ...s, start: c.to.start, end: c.to.end, ...(c.wait ? { waitHandover: true } : {}) } : s; }) };
}

/** Vorschau einer Programmänderung: wen betrifft es? (Konzept: „Kira 03:00 → 03:30, Jay 05:00 → 04:30 (kürzer)“) */
export function diffSlots(before: CrewEvent, after: CrewEvent): SlotChange[] {
  const out: SlotChange[] = [];
  const old = new Map(before.slots.map(s => [s.id, s]));
  for (const s of after.slots) {
    const o = old.get(s.id);
    if (o && (o.start !== s.start || o.end !== s.end)) out.push({ slot: s.id, from: { start: o.start, end: o.end }, to: { start: s.start, end: s.end } });
  }
  return out;
}
