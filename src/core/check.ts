// Prüfung des Timetables (Konzept „Timetable“ → Prüfung): Überschneidung (rot), Lücke (grau „Umbau“), Slot nach
// Sperrstunde oder Floor-Ende (gelb), Slot außerhalb der Betriebszeit, Zeitumstellung im Tag, Tage überlappen.
// Die Ansicht übersetzt `kind` über i18n (check.*); hier stehen nur Fakten.
import { floorById, floorEndOf, floorOpen, sortSlots, type CrewEvent, type Day } from "./model";
import { dstTransition, offsetMin, MIN } from "./zeit";

export type CheckKind = "overlap" | "gap" | "afterCurfew" | "afterFloorEnd" | "outside" | "floorClosed" | "dst" | "dayOverlap" | "dstMoved";
export type Severity = "err" | "warn" | "info";
export const SEVERITY: Record<CheckKind, Severity> = {
  overlap: "err", dayOverlap: "err", dstMoved: "warn", afterCurfew: "warn", afterFloorEnd: "warn", outside: "warn", floorClosed: "warn", gap: "info", dst: "info",
};

export interface Finding {
  kind: CheckKind;
  severity: Severity;
  day: string;
  floor?: string;
  slots: string[];
  /** Zeitpunkte zur Anzeige (z. B. Beginn/Ende der Lücke, Umstellung) */
  from?: number;
  to?: number;
  /** Minuten (über Sperrstunde, Länge der Lücke) bzw. Richtung der Zeitumstellung in Minuten (+60/−60) */
  minutes?: number;
}

/** Prüft einen Tag. */
export function checkDay(ev: CrewEvent, day: Day): Finding[] {
  const out: Finding[] = [];
  for (const f of ev.floors) {
    const slots = sortSlots(ev.slots.filter(s => s.day === day.id && s.floor === f.id));
    if (!slots.length) continue;
    if (!floorOpen(day, f.id)) { out.push({ kind: "floorClosed", severity: "warn", day: day.id, floor: f.id, slots: slots.map(s => s.id) }); continue; }
    const fEnd = floorEndOf(day, f.id);
    const own = day.floors[f.id]?.end !== undefined;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]!;
      // Überschneidung mit allen späteren, die vor dem Ende beginnen (auf derselben Bühne bzw. ohne Bühne)
      for (let j = i + 1; j < slots.length; j++) {
        const o = slots[j]!;
        if (o.start >= s.end) break;
        if ((s.stage ?? "") !== (o.stage ?? "")) continue;
        out.push({ kind: "overlap", severity: "err", day: day.id, floor: f.id, slots: [s.id, o.id], from: o.start, to: Math.min(s.end, o.end) });
      }
      if (s.dstMoved) out.push({ kind: "dstMoved", severity: "warn", day: day.id, floor: f.id, slots: [s.id], from: s.start, to: s.end });
      if (s.start < day.start || s.end > day.end) out.push({ kind: "outside", severity: "warn", day: day.id, floor: f.id, slots: [s.id], from: s.start, to: s.end });
      if (own && s.end > fEnd) out.push({ kind: "afterFloorEnd", severity: "warn", day: day.id, floor: f.id, slots: [s.id], from: fEnd, to: s.end, minutes: Math.round((s.end - fEnd) / MIN) });
      else if (day.curfew !== null && s.end > day.curfew) out.push({ kind: "afterCurfew", severity: "warn", day: day.id, floor: f.id, slots: [s.id], from: day.curfew, to: s.end, minutes: Math.round((s.end - day.curfew) / MIN) });
      // Lücke zum nächsten (ohne Umbau-Slot dazwischen) = Umbau
      const n = slots[i + 1];
      if (n && n.start > s.end && !slots.some(x => x.start < n.start && x.end > s.end && x !== s && x !== n)) {
        out.push({ kind: "gap", severity: "info", day: day.id, floor: f.id, slots: [s.id, n.id], from: s.end, to: n.start, minutes: Math.round((n.start - s.end) / MIN) });
      }
    }
  }
  const t = dstTransition(day.start, day.end, ev.tz);
  if (t !== null) out.push({ kind: "dst", severity: "info", day: day.id, slots: [], from: t, minutes: offsetMin(day.end, ev.tz) - offsetMin(day.start, ev.tz) });
  return out;
}

/** Tage dürfen sich nicht überlappen. */
export function checkDays(ev: CrewEvent): Finding[] {
  const days = [...ev.days].sort((a, b) => a.start - b.start);
  const out: Finding[] = [];
  for (let i = 1; i < days.length; i++) {
    const a = days[i - 1]!, b = days[i]!;
    if (b.start < a.end) out.push({ kind: "dayOverlap", severity: "err", day: b.id, slots: [], from: b.start, to: a.end });
  }
  for (let i = 0; i < days.length; i++) for (let j = i + 1; j < days.length; j++) {
    if (days[i]!.date === days[j]!.date) out.push({ kind: "dayOverlap", severity: "err", day: days[j]!.id, slots: [] });
  }
  return out;
}

/** Alle Befunde eines Tages plus Tag-Überlappungen, die ihn betreffen. */
export function checkAll(ev: CrewEvent, dayId: string): Finding[] {
  const day = ev.days.find(d => d.id === dayId);
  if (!day) return [];
  const daysF = checkDays(ev).filter(f => f.day === dayId || ev.days.some(d => d.id === f.day && Math.abs(d.start - day.start) < 3 * 86_400_000));
  return [...daysF, ...checkDay(ev, day)];
}

/** Slots mit Befund (für die Ränder in der Zeitleiste). */
export function slotMarks(findings: Finding[]): Map<string, "clash" | "late"> {
  const m = new Map<string, "clash" | "late">();
  for (const f of findings) for (const id of f.slots) {
    if (f.kind === "overlap") m.set(id, "clash");
    else if ((f.kind === "afterCurfew" || f.kind === "dstMoved" || f.kind === "afterFloorEnd" || f.kind === "outside" || f.kind === "floorClosed") && m.get(id) !== "clash") m.set(id, "late");
  }
  return m;
}

/** Name eines Floors für Meldungen. */
export function floorName(ev: CrewEvent, id?: string): string { return (id && floorById(ev, id)?.name) || ""; }
