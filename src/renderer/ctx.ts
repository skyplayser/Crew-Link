// Gemeinsamer Zustand der Leitstand-Oberfläche. Die Veranstaltung gehört dem Hauptprozess; die Oberfläche schickt jede
// Änderung als neue Fassung (setEvent), der Hauptprozess prüft sie wie eine Datei und meldet den neuen Stand zurück.
import { ClockSync, FIRST_PROBES, FIRST_PROBE_GAP, REPEAT_EVERY, REPEAT_PROBES } from "../core/clock";
import { dayView } from "../core/countdown";
import { t } from "../core/i18n";
import type { CrewEvent } from "../core/model";
import type { AppState, CrewBridge } from "../shared/bridge";
import { toast } from "../shared/ui";

export type Tab = "now" | "timetable" | "clock" | "roles" | "signals" | "connect";

export const bridge = window.crew as CrewBridge;

export const C = {
  st: null as AppState | null,
  tab: "timetable" as Tab,
  /** gewählter Tag im TIMETABLE; "all" = ALLE TAGE */
  dayId: null as string | null,
  slotId: null as string | null,
  view: "timeline" as "timeline" | "list",
  listDay: "" as string,
  listFloor: "" as string,
  dragging: false,
  locked: false,
  rerender: () => { /* von app.ts gesetzt */ },
};

export function ev(): CrewEvent | null { return C.st?.event ?? null; }

// ------------------------------------------------------------------ Hausuhr der Oberfläche (über IPC abgeglichen)
const sync = new ClockSync();
export function now(): number { return sync.synced ? sync.now(performance.now()) : Date.now(); }
export function clockAccuracy(): number | null { return sync.accuracy; }

async function probe(): Promise<void> {
  const t1 = performance.now();
  const r = await bridge.clockPing().catch(() => null);
  const t4 = performance.now();
  if (r) sync.add(t1, r.r, r.s, t4, Date.now());
}
export async function startClockSync(): Promise<void> {
  for (let i = 0; i < FIRST_PROBES; i++) { await probe(); await new Promise(r => setTimeout(r, FIRST_PROBE_GAP)); }
  window.setInterval(async () => { for (let i = 0; i < REPEAT_PROBES; i++) { await probe(); await new Promise(r => setTimeout(r, FIRST_PROBE_GAP)); } }, REPEAT_EVERY);
}

// ------------------------------------------------------------------ Ändern

/** Ändern: Kopie bearbeiten und an den Hauptprozess geben. `changed`: betroffene Slots (GEÄNDERT am laufenden Tag). */
export async function edit(fn: (e: CrewEvent) => void | false, changed: string[] = []): Promise<boolean> {
  const cur = ev();
  if (!cur) return false;
  if (C.locked) { toast(t("lock.hint")); return false; }
  const copy = structuredClone(cur);
  if (fn(copy) === false) return false;
  // GEÄNDERT nur für Slots des laufenden Tages
  const v = dayView(copy, now());
  const mark = v.mode === "running" ? changed.filter(id => copy.slots.find(s => s.id === id)?.day === v.day.id || cur.slots.find(s => s.id === id)?.day === v.day.id) : [];
  const r = await bridge.setEvent(copy, mark);
  if (!r.ok) { toast(t("err.invalid", { e: r.error ?? "" }), true); return false; }
  return true;
}

/** Neue Veranstaltung übernehmen (ohne Sperrprüfung: kommt aus Dialogen). */
export async function replace(e: CrewEvent | null): Promise<boolean> {
  const r = await bridge.setEvent(e);
  if (!r.ok) { toast(t("err.invalid", { e: r.error ?? "" }), true); return false; }
  return true;
}
