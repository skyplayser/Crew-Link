// Was die Browser-Seiten bekommen (Rollen, große Uhr, öffentliche Seite): ein gefilterter Plan.
// - Öffentlich: nur öffentliche Namen, keine Notizen, keine Interna.
// - Privatsphäre-Modus (nur am Leitstand schaltbar): auch Rollen-Ansichten bekommen nur öffentliche Namen.
// - Notizen nur für Rollen, die sie brauchen (Leitung, Booth, DJ, Technik). PINs nie.
// Und die Hinweise (Banner), die jede Ansicht selbst aus Plan und Hausuhr ableitet – ohne neue Daten vom Netz.
import { curfewSequence, floorStatus, dayView, shownDay, type SeqKind } from "./countdown";
import { DEFAULT_SIGNALS, publicName, sortSlots, type CrewEvent, type Day, type Role, type Signals, type Slot, type SlotKind } from "./model";
import { MIN } from "./zeit";

export type Viewer = Role | "public" | "clock";

export interface WebSlot { id: string; day: string; floor: string; name: string; kind: SlotKind; start: number; end: number; note: string; public: string; handover?: number; readyAt?: number; waitHandover?: boolean }
export interface WebPlan {
  rev: number;
  name: string;
  place: string;
  tz: string;
  dayChange: number;
  days: Day[];
  floors: { id: string; name: string; color: number }[];
  slots: WebSlot[];
  settings: { handover: "plan" | "confirm" };
  signals: Signals;
  /** Programmänderungen am laufenden Tag: Slot → Zeitpunkt (GEÄNDERT 10 min lang) */
  changed: Record<string, number>;
  privacy: boolean;
}

const NOTE_ROLES: Viewer[] = ["lead", "booth", "dj", "tech"];

/**
 * Plan für eine Ansicht.
 * - `public` und `clock` (große Uhr hängt oft sichtbar für Gäste) und Privatsphäre-Modus: Namen = öffentliche Namen,
 *   kein `public`-Feld, keine Notizen.
 * - `public` bekommt nur das Nötigste: den gezeigten Tag und den folgenden, keine Übergabe-Zeitpunkte (nur „hat
 *   begonnen“), keine Hinweis-Einstellungen, kein Ort, keine Änderungsmarken.
 */
export function planFor(ev: CrewEvent, viewer: Viewer, o: { rev: number; privacy: boolean; changed?: Record<string, number>; now?: number }): WebPlan {
  const isPublic = viewer === "public";
  const pub = isPublic || viewer === "clock" || o.privacy;
  const notes = !pub && NOTE_ROLES.includes(viewer);
  let days = ev.days;
  if (isPublic) {
    const shown = shownDay(ev, o.now ?? Date.now());
    const i = shown ? ev.days.indexOf(shown) : -1;
    days = i >= 0 ? ev.days.slice(i, i + 2) : [];
  }
  const dayIds = new Set(days.map(d => d.id));
  return {
    rev: o.rev, name: ev.name, place: isPublic ? "" : ev.place, tz: ev.tz, dayChange: ev.dayChange,
    days: days.map(d => ({ ...d, floors: { ...d.floors } })),
    floors: ev.floors.map(f => ({ id: f.id, name: f.name, color: f.color })),
    slots: sortSlots(ev.slots.filter(s => dayIds.has(s.day))).map(s => ({
      id: s.id, day: s.day, floor: s.floor, kind: s.kind, start: s.start, end: s.end,
      name: pub ? publicName(s) : s.name, public: pub ? "" : s.public, note: notes ? s.note : "",
      // öffentlich nur „Übergabe ist erfolgt“ (0), nie der Zeitpunkt
      ...(s.handover !== undefined ? { handover: isPublic ? 0 : s.handover } : {}),
      ...(s.readyAt !== undefined && !isPublic ? { readyAt: s.readyAt } : {}),
      ...(s.waitHandover ? { waitHandover: true } : {}),
    })),
    settings: { handover: ev.settings.handover },
    signals: isPublic ? { ...DEFAULT_SIGNALS } : { ...ev.signals },
    changed: isPublic ? {} : { ...(o.changed ?? {}) },
    privacy: o.privacy,
  };
}

/** Kurzname für /r/dj/<name>: klein, ohne Sonderzeichen. */
export function nameSlug(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

// ------------------------------------------------------------------ Hinweise

export type NoticeKind = "prep30" | "next10" | "setEnd5" | "handover" | "over" | "confirmHandover" | "changeover" | SeqKind | "changed";
export interface Notice {
  /** stabil (für „weggetippt“) */
  id: string;
  kind: NoticeKind;
  /** Ton: info (cyan), warn (gelb), changed (GEÄNDERT) */
  tone: "info" | "warn" | "changed";
  floor?: string;
  at: number;
  until: number;
  /** Platzhalter für den Text: name, next, floor, time … */
  p: Record<string, string | number>;
  roles: Role[];
}

const ALL: Role[] = ["lead", "booth", "dj", "tech", "security", "bar"];
const SEQ_ROLES: Record<SeqKind, Role[]> = {
  entryStop: ["security", "lead"], lastRound: ["bar", "lead"], "curfew-warn": ALL, "curfew-last": ["booth", "dj", "lead"], curfew: ALL,
  "floor-warn": ALL, "floor-last": ["booth", "dj", "lead", "tech"], "floor-end": ALL,
};
const SHOW_MS = 5 * MIN;
export const CHANGED_MS = 10 * MIN;
/** Übergabe „bestätigen“: ab so viel Überziehen fragt Crew Link Leitung und Booth, ob die Übergabe schon war. */
export const CONFIRM_ASK_MS = 15 * MIN;

/**
 * Alle Hinweise des laufenden Tages, die zwischen `from` und `to` auftauchen bzw. aktiv sind. Ohne Ton, ohne Netz:
 * jede Ansicht rechnet sie selbst. Rollen-Filter macht `noticesFor`.
 */
export function dayNotices(plan: Pick<WebPlan, "days" | "floors" | "slots" | "settings" | "signals" | "changed">, day: Day, now: number): Notice[] {
  const out: Notice[] = [];
  const sig = plan.signals;
  for (const p of curfewSequence(plan, day)) {
    const tone = p.kind === "curfew" || p.kind === "floor-end" || p.kind === "curfew-last" || p.kind === "floor-last" || p.kind === "curfew-warn" || p.kind === "floor-warn" ? "warn" : "info";
    out.push({ id: `${day.id}-${p.kind}-${p.floor ?? ""}`, kind: p.kind, tone, ...(p.floor ? { floor: p.floor } : {}), at: p.at, until: p.at + SHOW_MS, p: { floor: plan.floors.find(f => f.id === p.floor)?.name ?? "" }, roles: SEQ_ROLES[p.kind] });
  }
  for (const f of plan.floors) {
    const slots = sortSlots(plan.slots.filter(s => s.day === day.id && s.floor === f.id) as Slot[]);
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]!, n = slots[i + 1];
      const music = s.kind !== "changeover" && s.kind !== "break";
      if (s.kind === "changeover") {
        out.push({ id: `${s.id}-changeover`, kind: "changeover", tone: "info", floor: f.id, at: s.start, until: Math.min(s.end, s.start + SHOW_MS), p: { floor: f.name, next: n ? n.name : "" }, roles: ["tech"] });
      }
      if (music) {
        out.push({ id: `${s.id}-prep30`, kind: "prep30", tone: "info", floor: f.id, at: s.start - sig.prepMin * MIN, until: s.start, p: { name: s.name, floor: f.name, min: sig.prepMin }, roles: ["dj"] });
      }
      if (music && n && n.kind !== "changeover" && n.kind !== "break" && n.start - s.end <= MIN) {
        out.push({ id: `${s.id}-next10`, kind: "next10", tone: "info", floor: f.id, at: s.end - sig.nextDjMin * MIN, until: s.end, p: { name: s.name, next: n.name, floor: f.name, min: sig.nextDjMin }, roles: ["booth", "dj", "tech"] });
        out.push({ id: `${s.id}-handover`, kind: "handover", tone: "info", floor: f.id, at: s.end, until: s.end + 2 * MIN, p: { name: s.name, next: n.name, floor: f.name }, roles: ["booth", "dj"] });
      }
      if (music) out.push({ id: `${s.id}-setEnd5`, kind: "setEnd5", tone: "info", floor: f.id, at: s.end - sig.setEndMin * MIN, until: s.end, p: { name: s.name, floor: f.name, min: sig.setEndMin }, roles: ["dj", "booth"] });
    }
    // Überzogen: nur wenn wirklich überzogen
    const st = floorStatus(plan, day, f.id, now);
    if (st.state === "over" && st.cur && st.remaining !== undefined && -st.remaining >= sig.overMin * MIN) {
      // Hinweis = cyan; der Text rechnet den echten Wert seit dem geplanten Ende (p.end)
      out.push({ id: `${st.cur.id}-over`, kind: "over", tone: "info", floor: f.id, at: st.cur.end + sig.overMin * MIN, until: Number.MAX_SAFE_INTEGER, p: { name: st.cur.name, floor: f.name, end: st.cur.end, next: st.next?.name ?? "" }, roles: ["lead", "booth"] });
      // ab +15 min: Übergabe bestätigen? (danach Rückfall auf den Plan, spätestens zum Ende des nächsten Slots)
      if (-st.remaining >= CONFIRM_ASK_MS) out.push({ id: `${st.cur.id}-confirm`, kind: "confirmHandover", tone: "info", floor: f.id, at: st.cur.end + CONFIRM_ASK_MS, until: Number.MAX_SAFE_INTEGER, p: { name: st.cur.name, floor: f.name, next: st.next?.name ?? "" }, roles: ["lead", "booth"] });
    }
  }
  for (const [slotId, at] of Object.entries(plan.changed)) {
    const s = plan.slots.find(x => x.id === slotId);
    if (!s || s.day !== day.id) continue;
    out.push({ id: `${slotId}-changed-${at}`, kind: "changed", tone: "changed", floor: s.floor, at, until: at + CHANGED_MS, p: { name: s.name, floor: plan.floors.find(f => f.id === s.floor)?.name ?? "", start: s.start, end: s.end }, roles: ALL });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Aktive Hinweise für eine Rolle (optional nur ein Floor; DJ optional nur eigene Slots). */
export function noticesFor(plan: WebPlan, role: Role, now: number, o: { floor?: string; djSlots?: string[] } = {}): Notice[] {
  const v = dayView(plan, now);
  if (v.mode !== "running") return [];
  return dayNotices(plan, v.day, now).filter(n => {
    if (now < n.at || now >= n.until || !n.roles.includes(role)) return false;
    if (o.floor && n.floor && n.floor !== o.floor) return false;
    if (role === "dj" && o.djSlots && (n.kind === "prep30" || n.kind === "next10" || n.kind === "setEnd5" || n.kind === "handover")) {
      const slotId = n.id.split("-")[0]!;
      const s = plan.slots.find(x => x.id === slotId);
      const nextOf = s ? sortSlots(plan.slots.filter(x => x.day === s.day && x.floor === s.floor) as Slot[]).find(x => x.start >= s.end) : undefined;
      return o.djSlots.includes(slotId) || (!!nextOf && o.djSlots.includes(nextOf.id) && n.kind !== "setEnd5");
    }
    return true;
  });
}

/** Hinweise der letzten Zeit für die Hinweis-Leiste am Leitstand (alle Rollen, neueste zuerst). */
export function recentNotices(plan: WebPlan, now: number, lookbackMs = 60 * MIN): Notice[] {
  const v = dayView(plan, now);
  const day = v.mode === "running" ? v.day : undefined;
  if (!day) return [];
  return dayNotices(plan, day, now).filter(n => n.at <= now && n.at >= now - lookbackMs).slice(0, 12);
}
