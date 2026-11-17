// Kern: Modell, Datei, Vorlagen, Countdowns, Überziehen, Prüfung, Hausuhr, Demo, Webserver-Prüfungen, Hinweise.
import { describe, expect, it } from "vitest";
import {
  builtinTemplates, copyDay, eventFromObject, fromTemplate, newEvent, newPin, parseEvent, parseTemplate, serializeEvent,
  timeInDay, toTemplate, type CrewEvent, type Slot,
} from "../src/core/model";
import { cdState, curfewPhase, curfewProgress, curfewSequence, dayView, floorStatus, fmtCountdown } from "../src/core/countdown";
import { applyChanges, previewShiftAll, previewShortenNext } from "../src/core/shift";
import { checkAll, checkDay, slotMarks } from "../src/core/check";
import { ClockSync, HouseClock, msToNextSecond, shotClockOffset } from "../src/core/clock";
import { makeDemo } from "../src/core/demo";
import { crewHere, crewTick, hostAllowed, isLocalSource, originAllowed, route, webCsp } from "../src/core/net";
import { nameSlug, noticesFor, planFor } from "../src/core/plan";
import { HOUR, localHM, MIN } from "../src/core/zeit";

const TZ = "Europe/Berlin";

/** Club-Nacht Sa 14.11.2026 22:00–06:00, Sperrstunde 05:00, Floors Main und Keller. */
function club(handover: "plan" | "confirm" = "plan"): CrewEvent {
  const ev = newEvent({ name: "Club", tz: TZ, days: [{ date: "2026-11-14", label: "Samstag", start: "22:00", end: "06:00", curfew: "05:00" }], floors: ["Main", "Keller"], consent: { save: true, log: false }, now: 1 });
  ev.settings.handover = handover;
  const d = ev.days[0]!, [main, keller] = ev.floors;
  const at = (hm: string) => timeInDay(ev, d, hm)!.ms;
  const s = (id: string, floor: string, name: string, a: string, b: string, o: Partial<Slot> = {}): Slot =>
    ({ id, day: d.id, floor, name, public: "", kind: "dj", start: at(a), end: at(b), note: "", ...o });
  ev.slots = [
    s("a", main!.id, "Lena", "22:00", "00:00"), s("b", main!.id, "Nova", "00:00", "03:00"), s("c", main!.id, "Kira", "03:00", "05:00"),
    s("k1", keller!.id, "Tom", "23:00", "02:40"), s("k2", keller!.id, "Mara", "02:40", "05:00", { public: "Special Guest" }),
  ];
  return ev;
}
const at = (ev: CrewEvent, hm: string) => timeInDay(ev, ev.days[0]!, hm)!.ms;

describe("Modell und Datei", () => {
  it("neue Veranstaltung: Tage über Mitternacht, PINs sechsstellig, Weboberfläche aus, Zustimmung gemerkt", () => {
    const ev = club();
    expect(ev.format).toBe("crew-link-event");
    expect(ev.id).toMatch(/^[0-9a-z]{12}$/);
    expect(localHM(ev.days[0]!.end, TZ)).toBe("06:00");
    expect(ev.days[0]!.end - ev.days[0]!.start).toBe(8 * HOUR);
    expect(ev.roles.pins.lead).toMatch(/^\d{6}$/);
    expect(ev.settings.web).toEqual({ on: false, port: 8070 });
    expect(ev.consent).toEqual({ save: true, log: false, at: 1 });
    for (let i = 0; i < 200; i++) expect(newPin()).not.toMatch(/^(\d)\1{5}$|^123456$/);
  });
  it(".crewlink: schreiben und lesen ergibt dasselbe", () => {
    const ev = club();
    const back = parseEvent(serializeEvent(ev));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.value).toEqual(ev);
  });
  it(".crewlink: Fremdes und Kaputtes wird abgelehnt oder verworfen", () => {
    expect(parseEvent("kein json")).toEqual({ ok: false, error: "json" });
    expect(parseEvent(JSON.stringify({ format: "vj-link" }))).toEqual({ ok: false, error: "format" });
    expect(parseEvent(JSON.stringify({ format: "crew-link-event", version: 99 }))).toEqual({ ok: false, error: "newer" });
    const ev = club() as unknown as Record<string, unknown>;
    const slots = (ev.slots as Record<string, unknown>[]);
    slots.push({ id: "x", day: "nope", floor: "nope", start: 1, end: 2 }, { id: "y", day: (ev.days as { id: string }[])[0]!.id, floor: (ev.floors as { id: string }[])[0]!.id, start: 5, end: 3 });
    slots[0]!.name = "Lena\u0000<b>";
    (ev.roles as Record<string, unknown>).pins = { lead: "12a456", booth: "123456" };
    const r = eventFromObject(ev);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.slots).toHaveLength(5);
    expect(r.value.slots[0]!.name).toBe("Lena <b>");
    expect(r.value.roles.pins).toEqual({ booth: "123456" });
    expect(parseEvent("x".repeat(5 * 1024 * 1024))).toEqual({ ok: false, error: "size" });
  });
  it("Vorlage: ohne Namen, Notizen, PINs; neue Veranstaltung mit gleichen Ortszeiten", () => {
    const ev = club();
    ev.slots[0]!.note = "geheim";
    const t = toTemplate(ev, "Jeden Samstag");
    const json = JSON.stringify(t);
    expect(json).not.toMatch(/Lena|Nova|geheim|Special Guest/);
    expect(json).not.toContain(ev.roles.pins.lead!);
    const p = parseTemplate(json);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const ev2 = fromTemplate(p.value, { name: "Neu", firstDate: "2027-10-30", consent: { save: false, log: false }, now: 2 });
    expect(ev2.days).toHaveLength(1);
    expect(localHM(ev2.days[0]!.start, TZ)).toBe("22:00");
    expect(localHM(ev2.days[0]!.curfew!, TZ)).toBe("05:00");
    expect(ev2.days[0]!.end - ev2.days[0]!.start).toBe(9 * HOUR); // Nacht der Zeitumstellung
    expect(ev2.slots).toHaveLength(5);
    expect(ev2.slots.every(s => s.name === "")).toBe(true);
    expect(ev2.slots.map(s => localHM(s.start, TZ)).sort()).toEqual(["00:00", "02:40", "03:00", "22:00", "23:00"]);
  });
  it("eingebaute Vorlagen: Jeden Samstag, Festival 3 Tage (mit Floor-Ende)", () => {
    const [club1, fest] = builtinTemplates();
    const e1 = fromTemplate(club1!, { name: "x", firstDate: "2026-11-21", consent: { save: false, log: false }, now: 0 });
    expect(e1.slots.length).toBe(5);
    const e2 = fromTemplate(fest!, { name: "y", firstDate: "2027-07-02", consent: { save: false, log: false }, now: 0 });
    expect(e2.days.map(d => localHM(d.start, TZ))).toEqual(["14:00", "12:00", "12:00"]);
    expect(localHM(e2.days[0]!.floors.b!.end!, TZ)).toBe("01:00");
    expect(e2.days[2]!.floors.b!.open).toBe(false);
  });
  it("Tag kopieren: Raster ohne Namen, Floor-Enden mit", () => {
    const ev = club();
    ev.days[0]!.floors[ev.floors[1]!.id] = { open: true, end: at(ev, "01:00") };
    const c = copyDay(ev, ev.days[0]!.id, "2026-11-21", "Samstag");
    expect(c.slots).toHaveLength(5);
    expect(localHM(c.day.floors[ev.floors[1]!.id]!.end!, TZ)).toBe("01:00");
  });
});

describe("Countdowns", () => {
  it("Zustände: grün, ab 10 min gelb, ab 2 min rot, danach überzogen", () => {
    expect(cdState(10 * MIN + 1)).toBe("ok");
    expect(cdState(10 * MIN)).toBe("warn");
    expect(cdState(2 * MIN)).toBe("crit");
    expect(cdState(0)).toBe("crit");
    expect(cdState(-1)).toBe("over");
  });
  it("Mitternacht: Slot 22:00–00:00 und 00:00–03:00 gehen nahtlos ineinander über", () => {
    const ev = club();
    const d = ev.days[0]!, main = ev.floors[0]!.id;
    expect(floorStatus(ev, d, main, at(ev, "00:00") - 1000)).toMatchObject({ state: "live", cur: { id: "a" }, remaining: 1000 });
    expect(floorStatus(ev, d, main, at(ev, "00:00"))).toMatchObject({ state: "live", cur: { id: "b" }, remaining: 3 * HOUR });
  });
  it("nächster Slot: ab 10 min vor Set-Ende im Übergabe-Fenster (cyan)", () => {
    const ev = club(), d = ev.days[0]!, main = ev.floors[0]!.id;
    expect(floorStatus(ev, d, main, at(ev, "02:49")).nextOn).toBe(false);
    expect(floorStatus(ev, d, main, at(ev, "02:50"))).toMatchObject({ nextOn: true, next: { id: "c" }, nextIn: 10 * MIN });
  });
  it("vor Beginn und nach dem letzten Slot", () => {
    const ev = club(), d = ev.days[0]!, keller = ev.floors[1]!.id;
    expect(floorStatus(ev, d, keller, at(ev, "22:30"))).toMatchObject({ state: "before", next: { id: "k1" }, nextIn: 30 * MIN });
    expect(floorStatus(ev, d, keller, at(ev, "05:30")).state).toBe("ended");
  });
  it("Überziehen bei Übergabe „bestätigen“: +Zeit seit geplantem Ende, bis zur Übergabe", () => {
    const ev = club("confirm"), d = ev.days[0]!, keller = ev.floors[1]!.id;
    ev.slots.find(s => s.id === "k1")!.handover = at(ev, "23:00");
    const t = at(ev, "02:40") + 6 * MIN + 48_000;
    const st = floorStatus(ev, d, keller, t);
    expect(st).toMatchObject({ state: "over", cur: { id: "k1" }, next: { id: "k2" } });
    expect(fmtCountdown(st.remaining!)).toBe("+6:48");
    // Übergabe bestätigt → der nächste läuft, endet wie geplant
    ev.slots.find(s => s.id === "k2")!.handover = t;
    expect(floorStatus(ev, d, keller, t + 1000)).toMatchObject({ state: "live", cur: { id: "k2" } });
    // bei „plan“ gibt es kein Überziehen
    const p = club("plan");
    expect(floorStatus(p, p.days[0]!, p.floors[1]!.id, t)).toMatchObject({ state: "live", cur: { id: "k2" } });
  });
  it("Floor zu und Floor-Ende", () => {
    const ev = club(), d = ev.days[0]!, keller = ev.floors[1]!.id;
    d.floors[keller] = { open: false };
    expect(floorStatus(ev, d, keller, at(ev, "01:00")).state).toBe("closed");
    d.floors[keller] = { open: true, end: at(ev, "01:00") };
    expect(floorStatus(ev, d, keller, at(ev, "00:30"))).toMatchObject({ ownEnd: true, floorEndIn: 30 * MIN });
  });
  it("Sperrstunde: Phasen und Folge-Zeitpunkte (Einlassstopp −60, Letzte Runde −30, −15, −5, 0), Floor-Ende eigene Folge", () => {
    const ev = club(), d = ev.days[0]!, c = d.curfew!;
    expect(curfewPhase(c, c - 16 * MIN)).toBe("normal");
    expect(curfewPhase(c, c - 15 * MIN)).toBe("warn");
    expect(curfewPhase(c, c - 5 * MIN)).toBe("last");
    expect(curfewPhase(c, c)).toBe("over");
    d.floors[ev.floors[1]!.id] = { open: true, end: at(ev, "01:00") };
    const seq = curfewSequence(ev, d);
    expect(seq.filter(x => !x.floor).map(x => [x.kind, localHM(x.at, TZ)])).toEqual([
      ["entryStop", "04:00"], ["lastRound", "04:30"], ["curfew-warn", "04:45"], ["curfew-last", "04:55"], ["curfew", "05:00"],
    ]);
    expect(seq.filter(x => x.floor).map(x => [x.kind, localHM(x.at, TZ)])).toEqual([["floor-warn", "00:45"], ["floor-last", "00:55"], ["floor-end", "01:00"]]);
    expect(curfewProgress(d, d.start)).toBe(0);
    expect(curfewProgress(d, c)).toBe(100);
  });
  it("Countdown zur Sperrstunde läuft über die doppelte Stunde richtig (25.10.2026)", () => {
    const ev = newEvent({ name: "x", tz: TZ, days: [{ date: "2026-10-24", label: "", start: "22:00", end: "06:00", curfew: "05:00" }], floors: ["Main"], consent: { save: false, log: false }, now: 0 });
    const d = ev.days[0]!;
    // 01:30 MESZ → 05:00 MEZ sind 4:30 h
    expect(fmtCountdown(d.curfew! - Date.parse("2026-10-24T23:30:00Z"))).toBe("4:30:00");
  });
});

describe("Überziehen: Nächsten kürzen / Alles verschieben (Vorschau, keine automatische Änderung)", () => {
  const over = () => {
    const ev = club("confirm");
    ev.slots.find(s => s.id === "k1")!.handover = at(ev, "23:00");
    return { ev, now: at(ev, "02:40") + 6 * MIN + 48_000 };
  };
  it("Nächsten kürzen: Mara beginnt 02:47 statt 02:40, endet wie geplant 05:00", () => {
    const { ev, now } = over();
    const before = JSON.stringify(ev);
    const p = previewShortenNext(ev, "k1", now);
    expect(JSON.stringify(ev)).toBe(before); // nichts geändert
    // „bestätigen“: k1 behält sein geplantes Ende (QA Runde 1, Nr. 5)
    expect(p.changes.map(c => [c.slot, localHM(c.to.start, TZ), localHM(c.to.end, TZ)])).toEqual([["k2", "02:47", "05:00"]]);
    const applied = applyChanges(ev, p.changes);
    expect(localHM(applied.slots.find(s => s.id === "k2")!.start, TZ)).toBe("02:47");
    expect(localHM(ev.slots.find(s => s.id === "k2")!.start, TZ)).toBe("02:40");
  });
  it("Alles verschieben: alle folgenden rücken nach, Warnung „7 min über Sperrstunde“ mit Vorschlag", () => {
    const { ev, now } = over();
    const p = previewShiftAll(ev, "k1", now);
    expect(p.changes.map(c => [c.slot, localHM(c.to.start, TZ), localHM(c.to.end, TZ)])).toEqual([["k2", "02:47", "05:07"]]);
    expect(p.warn).toMatchObject({ kind: "afterCurfew", minutes: 7, slot: "k2" });
    expect(localHM(p.warn!.suggest!.to.end, TZ)).toBe("05:00");
  });
  it("Alles verschieben auf einem Floor mit Floor-Ende warnt mit dem Floor-Ende", () => {
    const { ev, now } = over();
    ev.days[0]!.floors[ev.floors[1]!.id] = { open: true, end: at(ev, "05:00") };
    ev.days[0]!.curfew = at(ev, "05:30");
    expect(previewShiftAll(ev, "k1", now).warn).toMatchObject({ kind: "afterFloorEnd", minutes: 7 });
  });
  it("noch nicht überzogen: nichts zu verschieben; Nächsten kürzen ohne Rest warnt", () => {
    const { ev } = over();
    expect(previewShiftAll(ev, "k1", at(ev, "02:00")).changes).toEqual([]);
    expect(previewShortenNext(ev, "k1", at(ev, "05:10")).warn).toMatchObject({ kind: "nothingLeft" });
  });
});

describe("Prüfung", () => {
  it("Überschneidung (rot), Lücke (Umbau), nach Sperrstunde (gelb), außerhalb Betrieb, Zeitumstellung", () => {
    const ev = club(), d = ev.days[0]!, main = ev.floors[0]!.id;
    expect(checkDay(ev, d).filter(f => f.severity !== "info")).toEqual([]);
    ev.slots.push({ id: "j", day: d.id, floor: main, name: "Jay", public: "", kind: "dj", start: at(ev, "04:30"), end: at(ev, "06:30"), note: "" });
    const f = checkDay(ev, d);
    expect(f.find(x => x.kind === "overlap")).toMatchObject({ severity: "err", slots: ["c", "j"] });
    expect(f.find(x => x.kind === "afterCurfew")).toMatchObject({ severity: "warn", slots: ["j"], minutes: 90 });
    expect(f.find(x => x.kind === "outside")).toMatchObject({ slots: ["j"] });
    expect(slotMarks(f).get("c")).toBe("clash");
    ev.slots = ev.slots.filter(s => s.id !== "j");
    ev.slots.find(s => s.id === "c")!.start = at(ev, "03:30");
    expect(checkDay(ev, d).find(x => x.kind === "gap")).toMatchObject({ severity: "info", minutes: 30 });
    const dst = newEvent({ name: "x", tz: TZ, days: [{ date: "2026-10-24", label: "", start: "22:00", end: "06:00", curfew: "05:00" }], floors: ["Main"], consent: { save: false, log: false }, now: 0 });
    expect(checkAll(dst, dst.days[0]!.id).find(x => x.kind === "dst")).toMatchObject({ minutes: -60 });
  });
});

describe("Hausuhr", () => {
  it("Leitstand: folgt kleinen Abweichungen gleitend, fragt bei Sprung > 2 s, Übernehmen/Gleiten", () => {
    let mono = 0, wall = 1_800_000_000_000;
    const c = new HouseClock(() => mono, () => wall);
    mono += 1000; wall += 1000;
    expect(c.tick()).toBeNull();
    expect(c.now()).toBe(wall);
    // NTP stellt 500 ms vor: gleitet mit 0,1 s je s
    wall += 500; mono += 1000; wall += 1000;
    expect(c.tick()).toBeNull();
    expect(wall - c.now()).toBe(400);
    for (let i = 0; i < 5; i++) { mono += 1000; wall += 1000; c.tick(); }
    expect(wall - c.now()).toBe(0);
    // Sprung um 47 s: Frage, Hausuhr läuft frei weiter
    wall += 47_000; mono += 1000; wall += 1000;
    expect(c.tick()).toBe(47_000);
    expect(c.pendingJump).toBe(47_000);
    mono += 1000; wall += 1000; c.tick();
    expect(wall - c.now()).toBe(47_000);
    c.accept();
    expect(c.now()).toBe(wall);
    // Gleiten lassen: 10 s Abweichung → 100 s Gleiten
    wall += 10_000; mono += 1000; wall += 1000;
    expect(c.tick()).toBe(10_000);
    c.glide();
    for (let i = 0; i < 50; i++) { mono += 1000; wall += 1000; c.tick(); }
    expect(wall - c.now()).toBe(5000);
    for (let i = 0; i < 60; i++) { mono += 1000; wall += 1000; expect(c.tick()).toBeNull(); }
    expect(wall - c.now()).toBe(0);
    // Ruhezustand: neu ankern
    wall += 3_600_000; c.reanchor();
    expect(c.now()).toBe(wall);
  });
  it("Browser: kürzeste Laufzeit zählt, Ausreißer > 500 ms fallen weg, kleine Korrektur gleitet, nie rückwärts", () => {
    const s = new ClockSync();
    const house = (perf: number) => perf + 1_000_000; // wahre Hausuhr
    // Probe: Hin 30 ms, Rück 10 ms (asymmetrisch), Server braucht 1 ms
    const probe = (t1: number, up: number, down: number) => { const r = house(t1 + up), sv = r + 1; return s.add(t1, r, sv, t1 + up + 1 + down); };
    expect(probe(0, 30, 10)).toBe(true);
    expect(s.accuracy).toBe(20);
    expect(probe(100, 4, 4)).toBe(true);
    expect(s.accuracy).toBe(4);
    expect(Math.abs(s.now(200) - house(200))).toBeLessThan(1);
    expect(probe(300, 400, 300)).toBe(false); // > 500 ms
    expect(s.poor).toBe(false);
    // Leitstand-Uhr korrigiert 300 ms zurück: Anzeige läuft langsamer, nie rückwärts
    const s2 = new ClockSync();
    s2.add(0, 1000, 1000, 0);
    let last = s2.now(0);
    s2.add(1000, 1700, 1700, 1000);
    for (let p = 1000; p <= 5000; p += 50) { const h = s2.now(p); expect(h).toBeGreaterThanOrEqual(last); last = h; }
    expect(s2.now(5000)).toBe(5700);
    // große Abweichung (> 1 s): springt
    s2.add(6000, 10_000, 10_000, 6000);
    expect(s2.now(6000)).toBe(10_000);
    expect(msToNextSecond(1_000_250)).toBe(750);
    expect(msToNextSecond(1_000_995)).toBe(1005);
  });
  it("Browser: nach Schlaf aus der Wanduhr weiter", () => {
    const s = new ClockSync();
    s.add(0, 5000, 5000, 0, 4000); // Hausuhr = Wanduhr + 1000
    s.recoverFromWall(10, 9000);
    expect(s.now(10)).toBe(10_000);
  });
});

describe("Demo", () => {
  it("zwei Tage, drei Floors; jetzt: Main läuft, Keller überzogen, Terrasse vorbei, Sperrstunde in ca. 2 h", () => {
    for (const now of [Date.parse("2026-11-15T01:46:48Z"), Date.parse("2026-11-15T14:03:00Z"), Date.parse("2026-10-25T00:30:00Z"), Date.now()]) {
      const ev = makeDemo(now);
      expect(ev.demo).toBe(true);
      expect(ev.consent.save).toBe(false);
      expect(ev.days).toHaveLength(2);
      expect(ev.floors.map(f => f.name)).toEqual(["Main", "Keller", "Terrasse"]);
      const v = dayView(ev, now);
      expect(v.mode).toBe("running");
      if (v.mode !== "running") continue;
      expect(v.day.id).toBe("d1");
      const left = v.day.curfew! - now;
      expect(left).toBeGreaterThan(2 * HOUR);
      expect(left).toBeLessThanOrEqual(2 * HOUR + 15 * MIN);
      const main = floorStatus(ev, v.day, "main", now), keller = floorStatus(ev, v.day, "keller", now), terr = floorStatus(ev, v.day, "terrasse", now);
      expect(main).toMatchObject({ state: "live", cur: { name: "Nova" }, next: { name: "Kira" } });
      expect(main.remaining!).toBeGreaterThan(9 * MIN);
      expect(keller).toMatchObject({ state: "over", cur: { name: "Tom Riva" }, next: { name: "Mara Lux", public: "Special Guest" } });
      expect(terr.state).toBe("ended");
      expect(terr.ownEnd).toBe(true);
      expect(checkDay(ev, v.day).filter(f => f.severity === "err")).toEqual([]);
      expect(checkAll(ev, "d2").filter(f => f.severity === "err")).toEqual([]);
    }
  });
});

describe("Webserver-Prüfungen und Suite-Protokoll", () => {
  it("nur Quelladressen aus dem lokalen Netz", () => {
    for (const ok of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.20", "169.254.3.4", "127.0.0.1", "::ffff:192.168.0.5", "::1"]) expect(isLocalSource(ok)).toBe(true);
    for (const no of ["8.8.8.8", "172.32.0.1", "100.64.0.1", "192.169.0.1", "::ffff:8.8.8.8", "fe80::1", undefined, "999.1.1.1"]) expect(isLocalSource(no)).toBe(false);
  });
  it("Host-Kopf und Origin gegen DNS-Rebinding", () => {
    expect(hostAllowed("192.168.1.20:8070", 8070)).toBe(true);
    expect(hostAllowed("localhost:8070", 8070)).toBe(true);
    expect(hostAllowed("leitstand.local:8070", 8070)).toBe(true);
    expect(hostAllowed("evil.example.com:8070", 8070)).toBe(false);
    expect(hostAllowed("192.168.1.20:8080", 8070)).toBe(false);
    expect(hostAllowed("192.168.1.20", 8070)).toBe(false);
    expect(hostAllowed(undefined, 8070)).toBe(false);
    expect(originAllowed("http://192.168.1.20:8070", "192.168.1.20:8070")).toBe(true);
    expect(originAllowed("http://evil:8070", "192.168.1.20:8070")).toBe(false);
    expect(originAllowed(undefined, "192.168.1.20:8070")).toBe(false);
    expect(webCsp("192.168.1.20:8070")).toContain("connect-src 'self' ws://192.168.1.20:8070");
    expect(webCsp("x")).toContain("media-src data:");
  });
  it("Routen: Rollen, Uhr, öffentlich, kein Pfad-Traversal", () => {
    expect(route("/")).toEqual({ page: "choose" });
    expect(route("/r/bar")).toEqual({ page: "role", role: "bar" });
    expect(route("/r/leitung")).toEqual({ page: "role", role: "lead" });
    expect(route("/r/dj/kira")).toEqual({ page: "role", role: "dj", sub: "kira" });
    expect(route("/uhr/main")).toEqual({ page: "clock", floor: "main" });
    expect(route("/oeffentlich")).toEqual({ page: "public" });
    expect(route("/assets/web.js")).toEqual({ page: "asset", path: "/assets/web.js" });
    for (const bad of ["/r/admin", "/assets/../main.js", "/assets/%2e%2e/x", "/%E0%A4%A", "/x\\y", "/assets/a%00b"]) expect(route(bad)).toBeNull();
  });
  it("tick: nur öffentliche Namen, nur laufender Tag; here mit ver", () => {
    const now = Date.parse("2026-11-15T01:46:48Z");
    const ev = makeDemo(now);
    const tick = crewTick(ev, { now, rev: 3 });
    const json = JSON.stringify(tick);
    expect(json).not.toContain("Mara Lux");
    expect(json).toContain("Special Guest");
    expect(json).not.toContain("Jay Moreno"); // Tag 2
    expect(tick).toMatchObject({ t: "tick", src: "system", rev: 3, day: { id: "d1" }, curfew: { phase: "normal" } });
    expect((tick.floors as unknown[]).length).toBe(3);
    expect(new TextEncoder().encode(json).length).toBeLessThan(8 * 1024);
    expect(crewHere(ev, { ver: "0.1.0", http: "192.168.1.20:8070", rev: 3, now })).toMatchObject({ t: "here", app: "Crew Link", ver: "0.1.0", role: "lead", day: "d1" });
  });
});

describe("Pläne für die Browser und Hinweise", () => {
  it("öffentlich: nur öffentliche Namen, keine Notizen; Privatsphäre-Modus wirkt auf alle Rollen", () => {
    const ev = makeDemo(Date.parse("2026-11-15T01:46:48Z"));
    const pub = JSON.stringify(planFor(ev, "public", { rev: 1, privacy: false }));
    expect(pub).not.toContain("Mara Lux");
    expect(pub).not.toContain("Controller");
    expect(pub).not.toContain(ev.roles.pins.lead!);
    const bar = planFor(ev, "bar", { rev: 1, privacy: false });
    expect(JSON.stringify(bar)).toContain("Mara Lux");
    expect(bar.slots.every(s => s.note === "")).toBe(true);
    const dj = planFor(ev, "dj", { rev: 1, privacy: false });
    expect(dj.slots.some(s => s.note.length > 0)).toBe(true);
    expect(JSON.stringify(planFor(ev, "lead", { rev: 1, privacy: true }))).not.toContain("Mara Lux");
    expect(JSON.stringify(planFor(ev, "lead", { rev: 1, privacy: false }))).not.toContain(ev.roles.chatPin);
  });
  it("Hinweise je Rolle: Einlassstopp für Security, Letzte Runde für Bar, Überzogen für Leitung", () => {
    const now = Date.parse("2026-11-15T01:46:48Z");
    const ev = makeDemo(now);
    const plan = planFor(ev, "lead", { rev: 1, privacy: false });
    const c = ev.days[0]!.curfew!;
    const kinds = (role: Parameters<typeof noticesFor>[1], t: number) => noticesFor(plan, role, t).map(n => n.kind);
    expect(kinds("security", c - 60 * MIN)).toContain("entryStop");
    expect(kinds("bar", c - 60 * MIN)).not.toContain("entryStop");
    expect(kinds("bar", c - 29 * MIN)).toContain("lastRound");
    expect(kinds("lead", now)).toContain("over");
    expect(kinds("bar", now)).not.toContain("over");
    expect(nameSlug("Kira b2b Lena")).toBe("kira-b2b-lena");
    expect(nameSlug("Jürgen Groß")).toBe("jurgen-gross");
  });
});

describe("Screenshots: CREWLINK_SHOT_AT (nur mit --shot)", () => {
  const wall = Date.parse("2026-11-17T09:30:00Z");
  it("verschiebt die Hausuhr auf die angegebene Zeit", () => {
    const off = shotClockOffset("2026-11-16T01:17:00+01:00", true, wall);
    expect(wall + off).toBe(Date.parse("2026-11-16T00:17:00Z"));
    let mono = 5000, w = wall;
    const h = new HouseClock(() => mono, () => w + off);
    expect(h.now()).toBe(Date.parse("2026-11-16T00:17:00Z"));
    mono += 1000; w += 1000;
    expect(h.tick()).toBeNull(); // kein „Uhr springt“
    expect(h.now()).toBe(Date.parse("2026-11-16T00:17:01Z"));
  });
  it("ohne --shot, ohne Wert oder ungültig: keine Wirkung", () => {
    expect(shotClockOffset("2026-11-16T01:17:00+01:00", false, wall)).toBe(0);
    expect(shotClockOffset(undefined, true, wall)).toBe(0);
    expect(shotClockOffset("", true, wall)).toBe(0);
    expect(shotClockOffset("2026-11-16T01:17:00", true, wall)).toBe(0); // ohne Zone mehrdeutig
    expect(shotClockOffset("morgen 1 Uhr", true, wall)).toBe(0);
    expect(shotClockOffset("2026-13-45T99:00:00Z", true, wall)).toBe(0);
  });
});
