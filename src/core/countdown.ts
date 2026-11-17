// Countdowns, laufender Tag, Floor-Zustand und Sperrstunden-Folge (Konzept „Countdowns“, „Sperrstunde“).
// Countdowns sind immer „Zeitpunkt minus Hausuhr“ – sie laufen ohne neue Daten richtig weiter.
// Zeitgrenzen (10:00, 2:00, −15, −5) stehen hier, nicht im CSS: die Ansicht setzt nur die Klasse.
import { floorEndOf, floorOpen, sortSlots, type CrewEvent, type Day, type Signals, type Slot } from "./model";

/** Was Countdowns brauchen: Slots, Übergabe-Art, Hinweis-Zeiten (die Browser bekommen nur das, nicht die ganze Datei). */
export interface PlanLike { slots: Slot[]; settings: { handover: "plan" | "confirm" }; signals: Signals }
import { MIN } from "./zeit";

export const WARN_MS = 10 * MIN;
export const CRIT_MS = 2 * MIN;
/** Zwei Slots gelten als direkt hintereinander (Übergabe nötig), wenn höchstens so viel Zeit dazwischen liegt. */
export const ADJACENT_MS = MIN;

export type CdState = "ok" | "warn" | "crit" | "over";
/** Zustand eines Countdowns bis zu einem Ende: grün, ab 10 min gelb, ab 2 min rot, danach rot mit „+“. */
export function cdState(remainingMs: number): CdState {
  if (remainingMs < 0) return "over";
  if (remainingMs <= CRIT_MS) return "crit";
  if (remainingMs <= WARN_MS) return "warn";
  return "ok";
}

/**
 * Anzeige: unter 1 h „mm:ss“, darüber „h:mm:ss“; überzogen „+m:ss“ (bzw. „+h:mm:ss“).
 * Verbleibende Zeit wird aufgerundet (bei 0,4 s Rest steht noch 00:01), überzogene abgerundet.
 */
export function fmtCountdown(ms: number): string {
  const over = ms < 0;
  const total = over ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const ss = String(s).padStart(2, "0");
  if (over) return h ? `+${h}:${String(m).padStart(2, "0")}:${ss}` : `+${m}:${ss}`;
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}

// ------------------------------------------------------------------ Tage

export type DayView =
  | { mode: "running"; day: Day; index: number }
  | { mode: "between"; next: Day; index: number; inMs: number; prev?: Day }
  | { mode: "after"; last: Day }
  | { mode: "empty" };

/** Laufender Tag: Betrieb [Beginn, Ende). Zwischen zwei Tagen: der nächste mit Restzeit („Nächster Tag … in 7:42:10“). */
export function dayView(ev: Pick<CrewEvent, "days">, now: number): DayView {
  const days = [...ev.days].sort((a, b) => a.start - b.start);
  if (!days.length) return { mode: "empty" };
  for (let i = 0; i < days.length; i++) {
    const d = days[i]!;
    if (now >= d.start && now < d.end) return { mode: "running", day: d, index: i };
    if (now < d.start) return { mode: "between", next: d, index: i, inMs: d.start - now, ...(i > 0 ? { prev: days[i - 1]! } : {}) };
  }
  return { mode: "after", last: days[days.length - 1]! };
}

/** Der Tag, den Ansichten zeigen: laufender, sonst nächster, sonst letzter. */
export function shownDay(ev: Pick<CrewEvent, "days">, now: number): Day | undefined {
  const v = dayView(ev, now);
  return v.mode === "running" ? v.day : v.mode === "between" ? v.next : v.mode === "after" ? v.last : undefined;
}

// ------------------------------------------------------------------ Floor-Zustand

export interface FloorStatus {
  /** before: Tag/Floor noch nicht begonnen · live: Slot läuft · over: Slot überzogen (Übergabe offen) ·
   *  gap: Lücke/Umbau ohne Slot · ended: Floor-Ende vorbei oder alle Slots vorbei · closed: Floor heute zu */
  state: "before" | "live" | "over" | "gap" | "ended" | "closed";
  cur?: Slot;
  /** Countdown bis Set-Ende (negativ = überzogen) */
  remaining?: number;
  next?: Slot;
  /** Countdown bis Beginn des nächsten Slots */
  nextIn?: number;
  /** Übergabe-Fenster (ab −10 min vor Set-Ende): „nächster Slot“ wird cyan */
  nextOn: boolean;
  /** Floor-Ende bzw. Ende der Musik auf dem Floor */
  floorEnd: number;
  floorEndIn: number;
  /** Floor hat ein eigenes Floor-Ende (vor der Sperrstunde) */
  ownEnd: boolean;
}

/** Braucht Slot b eine Übergabe von Slot a (direkt hintereinander, beide mit Musik)? */
function needsHandover(a: Slot, b: Slot): boolean {
  const music = (s: Slot) => s.kind !== "changeover" && s.kind !== "break";
  return music(a) && music(b) && (b.start - a.end <= ADJACENT_MS || b.waitHandover === true);
}

/**
 * Rückfall auf den Plan bei Übergabe „bestätigen“: Fehlt die Bestätigung, gilt spätestens ab dem früheren von
 * geplantem Ende des nächsten Slots, Floor-Ende und Sperrstunde wieder der Plan (nie stundenlang „überzogen“).
 */
export function handoverFallback(next: Pick<Slot, "end">, day: Day, floorId: string): number {
  return Math.min(next.end, floorEndOf(day, floorId), day.curfew ?? Infinity);
}

/**
 * Was läuft auf dem Floor? Übergabe „plan“: der Plan gilt. Übergabe „confirm“: ein Slot, der direkt auf einen
 * anderen folgt, beginnt erst mit der bestätigten Übergabe – bis dahin ist der vorige überzogen (Countdown „+“).
 */
export function floorStatus(ev: PlanLike, day: Day, floorId: string, now: number): FloorStatus {
  const floorEnd = floorEndOf(day, floorId);
  const ownEnd = day.floors[floorId]?.end !== undefined;
  const base = { nextOn: false, floorEnd, floorEndIn: floorEnd - now, ownEnd };
  if (!floorOpen(day, floorId)) return { state: "closed", ...base };
  const slots = sortSlots(ev.slots.filter(s => s.day === day.id && s.floor === floorId));
  const confirm = ev.settings.handover === "confirm";
  const windowMs = ev.signals.nextDjMin * MIN;
  // Wie hat jeder Slot begonnen? confirmed = bestätigte Übergabe, plan = nach Plan, fallback = Rückfall ohne
  // Bestätigung, chain = nach einem Rückfall gilt für den Floor wieder der Plan (kein Hinterherlaufen um einen Slot).
  const how: ("confirmed" | "plan" | "fallback" | "chain" | "none")[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]!;
    const prev = i > 0 ? how[i - 1]! : "plan";
    if (s.handover !== undefined) how.push(s.handover <= now ? "confirmed" : "none");
    else if (s.start > now) how.push("none");
    else if (!confirm || i === 0 || !needsHandover(slots[i - 1]!, s)) how.push("plan");
    else if (prev === "fallback" || prev === "chain") how.push("chain");
    else how.push(now >= handoverFallback(s, day, floorId) ? "fallback" : "none");
  }
  let playing = -1;
  for (let i = 0; i < slots.length; i++) if (how[i] !== "none") playing = i;
  const nextAfter = (i: number) => slots.slice(i + 1).find(s => s.handover === undefined || s.handover > now);
  if (playing < 0) {
    const next = slots[0];
    // noch nichts begonnen: vor dem ersten Slot (bzw. vor Tagesbeginn); ohne Slots und nach Floor-Ende: vorbei
    const state = now >= floorEnd ? "ended" : next || now < day.start ? "before" : "gap";
    return { state, ...base, ...(next ? { next, nextIn: next.start - now, nextOn: next.start - now <= windowMs } : {}) };
  }
  const cur = slots[playing]!;
  const remaining = cur.end - now;
  const next = nextAfter(playing);
  const nextIn = next ? next.start - now : undefined;
  if (remaining > 0) {
    return { state: "live", cur, remaining, ...base, ...(next ? { next, nextIn } : {}), nextOn: !!next && remaining <= windowMs };
  }
  // Slot vorbei. Überzogen, wenn der nächste schon dran wäre (bzw. nach „Nächsten kürzen“ auf die Übergabe wartet),
  // aber die Übergabe fehlt (nur bei „confirm“, nur bis zum Rückfall auf den Plan).
  const afterFallback = how[playing] === "fallback" || how[playing] === "chain";
  if (confirm && !afterFallback && next && (next.start <= now || next.waitHandover === true) && needsHandover(cur, next) && now < handoverFallback(next, day, floorId)) {
    return { state: "over", cur, remaining, ...base, next, nextIn: nextIn!, nextOn: true };
  }
  if (next) return { state: "gap", ...base, next, nextIn: nextIn! };
  return { state: "ended", ...base };
}

// ------------------------------------------------------------------ Sperrstunde

export type CurfewPhase = "normal" | "warn" | "last" | "over";
/** Sperrstunde des Tages: ab −15 min „warn“ (gelb), ab −5 min „last“ (rot), danach „over“ (SPERRSTUNDE). */
export function curfewPhase(at: number, now: number, sig: Pick<Signals, "curfewWarnMin" | "curfewLastMin"> = { curfewWarnMin: 15, curfewLastMin: 5 }): CurfewPhase {
  const r = at - now;
  if (r <= 0) return "over";
  if (r <= sig.curfewLastMin * MIN) return "last";
  if (r <= sig.curfewWarnMin * MIN) return "warn";
  return "normal";
}

export type SeqKind = "entryStop" | "lastRound" | "curfew-warn" | "curfew-last" | "curfew" | "floor-warn" | "floor-last" | "floor-end";
export interface SeqPoint { kind: SeqKind; at: number; floor?: string }

/** Sperrstunden-Folge des Tages (Einlassstopp −60, Letzte Runde −30, −15, −5, 0) und je Floor mit eigenem Floor-Ende dieselbe Folge. */
export function curfewSequence(ev: { signals: Signals; floors: { id: string }[] }, day: Day): SeqPoint[] {
  const s = ev.signals, out: SeqPoint[] = [];
  if (day.curfew !== null) {
    const c = day.curfew;
    out.push({ kind: "entryStop", at: c - s.entryStopMin * MIN }, { kind: "lastRound", at: c - s.lastRoundMin * MIN },
      { kind: "curfew-warn", at: c - s.curfewWarnMin * MIN }, { kind: "curfew-last", at: c - s.curfewLastMin * MIN }, { kind: "curfew", at: c });
  }
  for (const f of ev.floors) {
    const e = day.floors[f.id]?.end;
    if (e === undefined || !floorOpen(day, f.id)) continue;
    if (day.curfew !== null && e >= day.curfew) continue;
    out.push({ kind: "floor-warn", at: e - s.curfewWarnMin * MIN, floor: f.id }, { kind: "floor-last", at: e - s.curfewLastMin * MIN, floor: f.id }, { kind: "floor-end", at: e, floor: f.id });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Fortschritt des Tages bis zur Sperrstunde (0–100) für den Balken der großen Uhr. */
export function curfewProgress(day: Day, now: number): number {
  const end = day.curfew ?? day.end;
  if (end <= day.start) return 0;
  return Math.max(0, Math.min(100, ((now - day.start) / (end - day.start)) * 100));
}
