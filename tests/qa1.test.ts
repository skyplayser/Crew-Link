// QA Runde 1: Zeitumstellung beim Kopieren/Vorlagen/Anlegen (1–3), Rückfall bei „bestätigen“ (4),
// Kürzen/Verschieben lässt das geplante Ende stehen (5), große Uhr nur öffentlich (6), Hinweise (10), öffentlicher Plan (15).
import { describe, expect, it } from "vitest";
import { copyDay, fromTemplate, GapError, makeDay, newEvent, timeInDay, toTemplate, type CrewEvent, type Slot } from "../src/core/model";
import { checkDay } from "../src/core/check";
import { floorStatus, fmtCountdown } from "../src/core/countdown";
import { applyChanges, previewShiftAll, previewShortenNext } from "../src/core/shift";
import { noticesFor, planFor } from "../src/core/plan";
import { makeDemo } from "../src/core/demo";
import { HOUR, localHM, MIN } from "../src/core/zeit";

const TZ = "Europe/Berlin";
const mk = (date: string, extra: Partial<Slot>[] = []): CrewEvent => {
  const ev = newEvent({ name: "x", tz: TZ, days: [{ date, label: "", start: "22:00", end: "06:00", curfew: "05:00" }], floors: ["Main"], consent: { save: false, log: false }, now: 0 });
  const d = ev.days[0]!;
  const at = (hm: string) => timeInDay(ev, d, hm)!.ms;
  ev.slots = [
    { id: "a", day: d.id, floor: ev.floors[0]!.id, name: "A", public: "", kind: "dj", start: at("22:00"), end: at("02:00"), note: "" },
    { id: "b", day: d.id, floor: ev.floors[0]!.id, name: "B", public: "", kind: "dj", start: at("02:00"), end: at("03:00"), note: "" },
    { id: "c", day: d.id, floor: ev.floors[0]!.id, name: "C", public: "Guest", kind: "dj", start: at("03:00"), end: at("05:00"), note: "geheim" },
  ].map((s, i) => ({ ...s, ...(extra[i] ?? {}) })) as Slot[];
  return ev;
};

describe("QA 1–3: fehlende Stunde nie still verwerfen oder verschieben", () => {
  it("Tag kopieren in die März-Nacht: Slot bleibt, Beginn 03:00, Länge gleich, gelbe Prüf-Karte", () => {
    const ev = mk("2026-03-21");
    const c = copyDay(ev, ev.days[0]!.id, "2026-03-28", "Samstag");
    expect(c.slots).toHaveLength(3);
    const b = c.slots[1]!;
    expect(localHM(b.start, TZ)).toBe("03:00");
    expect(b.end - b.start).toBe(HOUR);
    expect(b.dstMoved).toBe(true);
    expect(c.slots[2]!.dstMoved).toBeUndefined();
    // A (22:00–02:00) endet in der Lücke: Länge 4 h bleibt → endet 03:00, B schließt an
    expect(c.slots[0]!.end).toBe(b.start);
    const ev2 = { ...ev, days: [...ev.days, c.day], slots: [...ev.slots, ...c.slots] };
    const f = checkDay(ev2, c.day).filter(x => x.kind === "dstMoved");
    expect(f.map(x => x.slots[0])).toContain(b.id);
    expect(f.every(x => x.severity === "warn")).toBe(true);
  });
  it("Vorlage in die März-Nacht: kein Slot verschwindet, Länge bleibt", () => {
    const ev = mk("2026-03-21");
    const e2 = fromTemplate(toTemplate(ev, "T"), { name: "n", firstDate: "2026-03-28", consent: { save: false, log: false }, now: 0 });
    expect(e2.slots).toHaveLength(3);
    const moved = e2.slots.filter(s => s.dstMoved);
    const b = moved.find(s => localHM(s.start, TZ) === "03:00" && s.end - s.start === HOUR);
    expect(b).toBeTruthy();
    expect(e2.slots.find(s => localHM(s.start, TZ) === "22:00")!.end - e2.slots.find(s => localHM(s.start, TZ) === "22:00")!.start).toBe(4 * HOUR);
  });
  it("Tag anlegen: Uhrzeit in der fehlenden Stunde wird abgelehnt (GapError), nie still verschoben", () => {
    const ev = mk("2026-03-21");
    expect(() => makeDay(ev, { date: "2026-03-28", label: "", start: "22:00", end: "06:00", curfew: "02:30" })).toThrow(GapError);
    try { makeDay(ev, { date: "2026-03-28", label: "", start: "22:00", end: "06:00", curfew: "02:30" }); } catch (e) { expect((e as GapError).value).toBe("02:30"); expect((e as GapError).date).toBe("2026-03-29"); }
    expect(() => makeDay(ev, { date: "2026-03-28", label: "", start: "22:00", end: "06:00", curfew: "05:00" })).not.toThrow();
    // Vorlagen dürfen (mit Prüfung) – sonst ginge der ganze Tag verloren
    expect(localHM(makeDay(ev, { date: "2026-03-28", label: "", start: "22:00", end: "06:00", curfew: "02:30" }, undefined, { allowGap: true }).curfew!, TZ)).toBe("03:30");
  });
});

describe("QA 4: Übergabe „bestätigen“ ohne Bestätigung fällt auf den Plan zurück", () => {
  const conf = () => { const ev = mk("2026-11-14", [{ handover: undefined }]); ev.settings.handover = "confirm"; return ev; };
  it("bis zum Ende des nächsten Slots überzogen, danach gilt der Plan", () => {
    const ev = conf(), d = ev.days[0]!, f = ev.floors[0]!.id;
    const at = (hm: string) => timeInDay(ev, d, hm)!.ms;
    expect(floorStatus(ev, d, f, at("02:30"))).toMatchObject({ state: "over", cur: { id: "a" } });
    expect(floorStatus(ev, d, f, at("03:00") - 1000)).toMatchObject({ state: "over", cur: { id: "a" } });
    // 03:00 = Ende von B: Rückfall; laut Plan läuft C (C braucht wieder eine Übergabe von B → B gilt als gelaufen)
    const st = floorStatus(ev, d, f, at("03:00"));
    expect(st.cur?.id).not.toBe("a");
    // um 05:30 nichts mehr überzogen (früher: „+3:30:00 A“)
    const late = floorStatus(ev, d, f, at("05:30"));
    expect(late.state).toBe("ended");
  });
  it("Sperrstunde und Floor-Ende begrenzen ebenso", () => {
    const ev = conf(), d = ev.days[0]!, f = ev.floors[0]!.id;
    const at = (hm: string) => timeInDay(ev, d, hm)!.ms;
    d.floors[f] = { open: true, end: at("02:20") };
    expect(floorStatus(ev, d, f, at("02:10")).state).toBe("over");
    expect(floorStatus(ev, d, f, at("02:20")).cur?.id).not.toBe("a");
  });
  it("ab +15 min Hinweis „Übergabe bestätigen?“ an Leitung und Booth", () => {
    const ev = conf(), d = ev.days[0]!;
    const at = (hm: string) => timeInDay(ev, d, hm)!.ms;
    const plan = planFor(ev, "lead", { rev: 1, privacy: false });
    expect(noticesFor(plan, "lead", at("02:14")).map(n => n.kind)).not.toContain("confirmHandover");
    expect(noticesFor(plan, "booth", at("02:15")).map(n => n.kind)).toContain("confirmHandover");
    expect(noticesFor(plan, "bar", at("02:15")).map(n => n.kind)).not.toContain("confirmHandover");
    const over = noticesFor(plan, "lead", at("02:15")).find(n => n.kind === "over")!;
    expect(over.tone).toBe("info");
    expect(over.p.end).toBe(at("02:00"));
  });
});

describe("QA 5: Kürzen/Verschieben bei Überziehen ändern das geplante Ende nicht", () => {
  const conf = () => { const ev = mk("2026-11-14"); ev.settings.handover = "confirm"; return ev; };
  it("Nächsten kürzen: nur B ändert sich und wartet; Anzeige bleibt „+“ bis zur Übergabe", () => {
    const ev = conf(), d = ev.days[0]!, f = ev.floors[0]!.id;
    const at = (hm: string) => timeInDay(ev, d, hm)!.ms;
    const now = at("02:06") + 20_000;
    const p = previewShortenNext(ev, "a", now);
    expect(p.changes.map(c => [c.slot, localHM(c.to.start, TZ), localHM(c.to.end, TZ), c.wait])).toEqual([["b", "02:07", "03:00", true]]);
    const e2 = applyChanges(ev, p.changes);
    expect(e2.slots.find(s => s.id === "a")!.end).toBe(at("02:00"));
    const st = floorStatus(e2, d, f, now + 30_000);
    expect(st.state).toBe("over");
    expect(fmtCountdown(st.remaining!)).toBe("+6:50");
    // auch nach dem neuen Beginn von B: weiter „+“ bis zur Übergabe
    expect(floorStatus(e2, d, f, at("02:08")).state).toBe("over");
    e2.slots.find(s => s.id === "b")!.handover = at("02:08");
    expect(floorStatus(e2, d, f, at("02:08") + 1000)).toMatchObject({ state: "live", cur: { id: "b" } });
  });
  it("Alles verschieben: A bleibt, B und C rücken um die Überziehung nach, Warnung über Sperrstunde", () => {
    const ev = conf();
    const d = ev.days[0]!;
    const at = (hm: string) => timeInDay(ev, d, hm)!.ms;
    const p = previewShiftAll(ev, "a", at("02:06") + 20_000);
    expect(p.changes.map(c => [c.slot, localHM(c.to.start, TZ), localHM(c.to.end, TZ)])).toEqual([["b", "02:07", "03:07"], ["c", "03:07", "05:07"]]);
    expect(p.changes[0]!.wait).toBe(true);
    expect(p.warn).toMatchObject({ kind: "afterCurfew", minutes: 7 });
  });
  it("bestätigte Übergabe bestimmt den Beginn", () => {
    const ev = conf();
    const d = ev.days[0]!;
    const at = (hm: string) => timeInDay(ev, d, hm)!.ms;
    ev.slots.find(s => s.id === "b")!.handover = at("02:04");
    const p = previewShortenNext(ev, "a", at("02:10"));
    expect(p.changes.map(c => localHM(c.to.start, TZ))).toEqual(["02:04"]);
    expect(p.changes[0]!.wait).toBeUndefined();
  });
});

describe("QA 6/15: große Uhr und öffentlicher Plan", () => {
  it("große Uhr: nur öffentliche Namen, keine Notizen", () => {
    const now = Date.parse("2026-11-15T01:46:48Z");
    const p = planFor(makeDemo(now), "clock", { rev: 1, privacy: false, now });
    const s = JSON.stringify(p);
    expect(s).not.toContain("Mara Lux");
    expect(s).toContain("Special Guest");
    expect(p.slots.every(x => x.note === "")).toBe(true);
  });
  it("öffentlich: nur gezeigter und folgender Tag, keine Übergabe-Zeitpunkte, keine Hinweis-Einstellungen", () => {
    const now = Date.parse("2026-11-15T01:46:48Z");
    const ev = makeDemo(now);
    ev.signals.entryStopMin = 77;
    const p = planFor(ev, "public", { rev: 1, privacy: false, now });
    expect(p.days.map(d => d.id)).toEqual(["d1", "d2"]);
    expect(p.slots.filter(s => s.handover !== undefined).every(s => s.handover === 0)).toBe(true);
    expect(p.signals.entryStopMin).toBe(60);
    // Zustand stimmt trotzdem: Keller überzogen (Tom Riva), Main Nova
    const d1 = p.days[0]!;
    expect(floorStatus(p, d1, "keller", now)).toMatchObject({ state: "over", cur: { name: "Tom Riva" } });
    expect(floorStatus(p, d1, "main", now)).toMatchObject({ state: "live", cur: { name: "Nova" } });
    expect(MIN).toBe(60_000);
  });
});

import { LeadWatch } from "../src/core/net";
describe("QA 7: zweiter Leitstand", () => {
  it("fremdes here mit role lead wird gemerkt; wer zuerst da war, gilt; nach 15 s vergessen", () => {
    const w = new LeadWatch("mypeer00001", 1000);
    const here = (peer: string, role = "lead") => ({ suite: "crew", v: 1, t: "here", peer, role, http: "192.168.1.30:8070", app: "Crew Link" });
    expect(w.hear(here("mypeer00001"), "10.0.0.1", 2000)).toBe(false); // eigenes
    expect(w.hear(here("other000001", "standby"), "10.0.0.2", 2000)).toBe(false);
    expect(w.hear({ ...here("other000001"), suite: "chat" }, "10.0.0.2", 2000)).toBe(false);
    // war schon da, als wir starteten (innerhalb von 6 s gehört) → der andere gilt
    expect(w.hear(here("other000001"), "10.0.0.2", 3000)).toBe(true);
    expect(w.hear(here("other000001"), "10.0.0.2", 8000)).toBe(false);
    expect(w.list()).toEqual([{ address: "10.0.0.2", http: "192.168.1.30:8070", weFirst: false }]);
    // kommt später dazu → wir gelten
    w.hear(here("late0000001"), "10.0.0.3", 60_000);
    expect(w.list().find(x => x.address === "10.0.0.3")!.weFirst).toBe(true);
    expect(w.expire(60_000 + 15_001)).toBe(true);
    expect(w.list()).toEqual([]);
  });
});

describe("QA Runde 2", () => {
  it("20: „bestätigen“ ohne jede Bestätigung, ganze Nacht: nach dem Rückfall gilt der Plan, C wird zu seiner Zeit JETZT", () => {
    const ev = newEvent({ name: "x", tz: TZ, days: [{ date: "2026-11-14", label: "", start: "22:00", end: "06:00", curfew: "05:00" }], floors: ["Main"], consent: { save: false, log: false }, now: 0 });
    ev.settings.handover = "confirm";
    const d = ev.days[0]!, f = ev.floors[0]!.id;
    const at = (hm: string) => timeInDay(ev, d, hm)!.ms;
    const s = (id: string, a: string, b: string): Slot => ({ id, day: d.id, floor: f, name: id, public: "", kind: "dj", start: at(a), end: at(b), note: "" });
    ev.slots = [s("A", "22:00", "02:00"), s("B", "02:00", "04:00"), s("C", "04:00", "05:00")];
    const seen: string[] = [];
    for (let t = at("22:00"); t < at("05:10"); t += 5 * MIN) {
      const st = floorStatus(ev, d, f, t);
      seen.push(`${localHM(t, TZ)} ${st.state} ${st.cur?.id ?? "-"}`);
    }
    const stateAt = (hm: string) => seen.find(x => x.startsWith(hm))!;
    expect(stateAt("01:55")).toBe("01:55 live A");
    expect(stateAt("02:30")).toBe("02:30 over A");       // ohne Bestätigung: A überzogen
    expect(stateAt("03:55")).toBe("03:55 over A");
    expect(stateAt("04:00")).toBe("04:00 live C");       // Rückfall zum Ende von B → ab jetzt Plan: C läuft
    expect(stateAt("04:30")).toBe("04:30 live C");
    expect(stateAt("05:00")).toBe("05:00 ended -");
    expect(seen.some(x => x.includes("over B") || x.includes("over C"))).toBe(false);
  });
  it("21: viele gefälschte here – höchstens 8 gemerkt, je peer und insgesamt gedrosselt", () => {
    const w = new LeadWatch("mypeer00001", 0);
    let news = 0;
    const t0 = 100_000;
    for (let i = 0; i < 36_600; i++) {
      const peer = `fake${String(i % 5000).padStart(8, "0")}`;
      if (w.hear({ suite: "crew", t: "here", role: "lead", peer, http: "10.1.2.3:8070" }, "10.1.2.3", t0 + Math.floor(i / 9000) * 1000)) news++;
    }
    expect(w.size).toBeLessThanOrEqual(8);
    expect(news).toBeLessThanOrEqual(5 * 50); // 5 Sekunden, höchstens 50 je Sekunde verarbeitet
    // derselbe peer innerhalb 1 s wird nicht neu verarbeitet
    const w2 = new LeadWatch("mypeer00001", 0);
    const here = { suite: "crew", t: "here", role: "lead", peer: "real0000001", http: "" };
    expect(w2.hear(here, "a", 10_000)).toBe(true);
    for (let i = 0; i < 100; i++) w2.hear(here, "a", 10_000 + i);
    expect(w2.list()).toHaveLength(1);
  });
  it("26: Tag kopieren in die Oktober-Nacht: Slot in der doppelten Stunde behält seine echte Länge und wird markiert", () => {
    const ev = mk("2026-10-17");
    const c = copyDay(ev, ev.days[0]!.id, "2026-10-24", "Samstag");
    const b = c.slots[1]!; // 02:00–03:00
    expect(b.end - b.start).toBe(HOUR);
    expect(b.dstMoved).toBe(true);
    expect(localHM(b.start, TZ)).toBe("02:00");
    // A (22:00–02:00, Ende in der doppelten Stunde): echte Länge 4 h
    expect(c.slots[0]!.end - c.slots[0]!.start).toBe(4 * HOUR);
    // C (03:00–05:00) ohne Mehrdeutigkeit: unverändert, ohne Marke
    expect(c.slots[2]!.dstMoved).toBeUndefined();
    expect(c.slots[2]!.end - c.slots[2]!.start).toBe(2 * HOUR);
  });
});
