// Zeitrechnung: Mitternacht, Tageswechsel, Zeitumstellung – die 13 Testfälle aus RECHERCHE §3.
import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { addDays, businessDate, dayTime, dstTransition, fromLocal, HOUR, localHM, localParts, MIN, offsetMin, parseHM } from "../src/core/zeit";
import { checkDays } from "../src/core/check";
import { copyDay, makeDay, newEvent, type CrewEvent } from "../src/core/model";
import { dayView, fmtCountdown } from "../src/core/countdown";

const TZ = "Europe/Berlin";
const Z = (iso: string) => Date.parse(iso);
const ev0 = (days: { date: string; start: string; end: string; curfew?: string }[] = [], dayChange = 480): CrewEvent =>
  newEvent({ name: "Test", tz: TZ, dayChange, days: days.map(d => ({ label: "", curfew: d.curfew ?? "", ...d })), floors: ["Main"], consent: { save: false, log: false }, now: 0 });

describe("zeit.ts – Grundlagen", () => {
  it("Ortszeit und Versatz Berlin", () => {
    expect(offsetMin(Z("2026-11-15T21:00:00Z"), TZ)).toBe(60);
    expect(offsetMin(Z("2026-07-01T12:00:00Z"), TZ)).toBe(120);
    expect(localHM(Z("2026-11-15T21:00:00Z"), TZ)).toBe("22:00");
    expect(localParts(Z("2026-11-15T21:00:00Z"), TZ)).toMatchObject({ y: 2026, m: 11, d: 15, h: 22, mi: 0, wd: 0 });
  });
  it("15.11.2026 22:00 → 21:00Z", () => {
    const r = fromLocal(TZ, 2026, 11, 15, 22, 0);
    expect(r).toEqual({ ms: Z("2026-11-15T21:00:00Z"), ambiguous: false, gap: false });
  });
  it("HH:MM lesen", () => {
    expect(parseHM("22:00")).toBe(1320);
    expect(parseHM("6:05")).toBe(365);
    expect(parseHM("0630")).toBe(390);
    expect(parseHM("24:00")).toBeNull();
    expect(parseHM("ab")).toBeNull();
  });
  it("Kalender über Monats- und Jahresgrenze", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });
  it("Countdown-Format", () => {
    expect(fmtCountdown(13 * MIN + 12_000)).toBe("13:12");
    expect(fmtCountdown(2 * HOUR + 13 * MIN + 12_000)).toBe("2:13:12");
    expect(fmtCountdown(400)).toBe("00:01");
    expect(fmtCountdown(0)).toBe("00:00");
    expect(fmtCountdown(-(6 * MIN + 48_000))).toBe("+6:48");
    expect(fmtCountdown(-(HOUR + 2 * MIN + 3_000))).toBe("+1:02:03");
  });
});

describe("RECHERCHE §3 – Testfälle 1–13", () => {
  it("1 · Sa 24.10.2026 22:00 – So 06:00 dauert 9 h, Ende 05:00Z", () => {
    const ev = ev0();
    const d = makeDay(ev, { date: "2026-10-24", label: "", start: "22:00", end: "06:00", curfew: "05:00" });
    expect(d.end - d.start).toBe(9 * HOUR);
    expect(d.end).toBe(Z("2026-10-25T05:00:00Z"));
  });

  it("2 · Sa 28.03.2026 22:00 – So 06:00 dauert 7 h (fehlende Stunde)", () => {
    const d = makeDay(ev0(), { date: "2026-03-28", label: "", start: "22:00", end: "06:00", curfew: "" });
    expect(d.end - d.start).toBe(7 * HOUR);
  });

  it("2b · 28.03.2027 und 31.10.2027 ebenso", () => {
    expect((() => { const d = makeDay(ev0(), { date: "2027-03-27", label: "", start: "22:00", end: "06:00", curfew: "" }); return d.end - d.start; })()).toBe(7 * HOUR);
    expect((() => { const d = makeDay(ev0(), { date: "2027-10-30", label: "", start: "22:00", end: "06:00", curfew: "" }); return d.end - d.start; })()).toBe(9 * HOUR);
  });

  it("3 · „02:30“ am 25.10.2026 gibt es zweimal: früh 00:30Z, spät 01:30Z", () => {
    const early = fromLocal(TZ, 2026, 10, 25, 2, 30);
    const late = fromLocal(TZ, 2026, 10, 25, 2, 30, 0, "late");
    expect(early).toEqual({ ms: Z("2026-10-25T00:30:00Z"), ambiguous: true, gap: false, other: Z("2026-10-25T01:30:00Z") });
    expect(late.ms).toBe(Z("2026-10-25T01:30:00Z"));
    expect(late.ambiguous).toBe(true);
    // gleiches am 31.10.2027
    expect(fromLocal(TZ, 2027, 10, 31, 2, 30).ambiguous).toBe(true);
  });

  it("4 · „02:30“ am 29.03.2026 gibt es nicht: Lücke erkannt (Eingabe wird abgelehnt)", () => {
    const r = fromLocal(TZ, 2026, 3, 29, 2, 30);
    expect(r.gap).toBe(true);
    expect(r.ms).toBe(Z("2026-03-29T01:30:00Z")); // compatible: 03:30 Sommerzeit
    expect(fromLocal(TZ, 2027, 3, 28, 2, 15).gap).toBe(true);
    expect(fromLocal(TZ, 2027, 3, 28, 3, 0).gap).toBe(false);
  });

  it("5 · Sa 02:00 gehört bei Tageswechsel 08:00 zu „Freitag“", () => {
    expect(businessDate(Z("2026-11-14T01:00:00Z"), TZ, 480)).toBe("2026-11-13"); // Sa 02:00 → Fr
    const ev = ev0([{ date: "2026-11-13", start: "22:00", end: "06:00" }]);
    expect(dayTime(TZ, "2026-11-13", 120, 480).ms).toBe(Z("2026-11-14T01:00:00Z"));
    void ev;
  });

  it("6 · Tageswechsel 12:00 (Afterhour): Slot 11:00 gehört zum Vortag", () => {
    expect(businessDate(Z("2026-11-15T10:00:00Z"), TZ, 720)).toBe("2026-11-14"); // So 11:00
    expect(businessDate(Z("2026-11-15T11:00:00Z"), TZ, 720)).toBe("2026-11-15"); // So 12:00
  });

  it("7 · Tag kopieren Sa 24.10. → Sa 31.10.2026: gleiche Ortszeiten, ms-Abstand ≠ 7·24 h", () => {
    const ev = ev0([{ date: "2026-10-24", start: "22:00", end: "06:00", curfew: "05:00" }]);
    const d = ev.days[0]!;
    ev.slots.push({ id: "a", day: d.id, floor: ev.floors[0]!.id, name: "Nova", public: "", kind: "dj", start: d.start + 3 * HOUR, end: d.start + 6 * HOUR, note: "x" });
    const c = copyDay(ev, d.id, "2026-10-31", "Samstag");
    expect(localHM(c.day.start, TZ)).toBe("22:00");
    expect(localHM(c.day.end, TZ)).toBe("06:00");
    expect(localHM(c.day.curfew!, TZ)).toBe("05:00");
    expect(c.day.start - d.start).toBe(7 * 24 * HOUR + HOUR); // Winterzeit: eine Stunde mehr
    const s = c.slots[0]!;
    expect(s.name).toBe(""); expect(s.note).toBe("");
    expect(localHM(s.start, TZ)).toBe(localHM(ev.slots[0]!.start, TZ));
    expect(localHM(s.end, TZ)).toBe(localHM(ev.slots[0]!.end, TZ));
  });

  it("8 · Festival Fr 14:00–04:00, Sa 12:00–04:00: Lücke ist kein Tag, „Nächster Tag in 8:00:00“", () => {
    const ev = ev0([{ date: "2027-07-02", start: "14:00", end: "04:00" }, { date: "2027-07-03", start: "12:00", end: "04:00" }]);
    const fr04 = ev.days[0]!.end;
    expect(dayView(ev, fr04 - 1)).toMatchObject({ mode: "running", day: { date: "2027-07-02" } });
    const v = dayView(ev, fr04);
    expect(v.mode).toBe("between");
    if (v.mode === "between") { expect(v.next.date).toBe("2027-07-03"); expect(fmtCountdown(v.inMs)).toBe("8:00:00"); }
    expect(dayView(ev, ev.days[1]!.end)).toMatchObject({ mode: "after" });
  });

  it("9 · Tage überlappen → Prüfung meldet Fehler", () => {
    const ev = ev0([{ date: "2027-07-02", start: "14:00", end: "14:00" }, { date: "2027-07-03", start: "12:00", end: "04:00" }], 480);
    const f = checkDays(ev);
    expect(f.some(x => x.kind === "dayOverlap" && x.severity === "err")).toBe(true);
    const ok = ev0([{ date: "2027-07-02", start: "14:00", end: "04:00" }, { date: "2027-07-03", start: "12:00", end: "04:00" }]);
    expect(checkDays(ok)).toEqual([]);
  });

  it("10 · Countdown über die Umstellung: Sperrstunde 05:00 am 25.10., um 02:00 MESZ sind es 4 h", () => {
    const d = makeDay(ev0(), { date: "2026-10-24", label: "", start: "22:00", end: "06:00", curfew: "05:00" });
    const at0200mesz = fromLocal(TZ, 2026, 10, 25, 2, 0).ms; // früher Zeitpunkt = Sommerzeit
    expect(offsetMin(at0200mesz, TZ)).toBe(120);
    expect(d.curfew! - at0200mesz).toBe(4 * HOUR);
    expect(fmtCountdown(d.curfew! - at0200mesz)).toBe("4:00:00");
    expect(dstTransition(d.start, d.end, TZ)).toBe(Z("2026-10-25T01:00:00Z"));
  });

  it("11 · Laufender Tag um 07:59:59 / 08:00:00 – Wechsel genau am Tageswechsel", () => {
    const ev = ev0([{ date: "2026-11-13", start: "22:00", end: "08:00" }, { date: "2026-11-14", start: "08:00", end: "06:00" }]);
    const t = fromLocal(TZ, 2026, 11, 14, 8, 0).ms;
    expect(dayView(ev, t - 1000)).toMatchObject({ mode: "running", day: { date: "2026-11-13" } });
    expect(dayView(ev, t)).toMatchObject({ mode: "running", day: { date: "2026-11-14" } });
    expect(businessDate(t - 1000, TZ, 480)).toBe("2026-11-13");
    expect(businessDate(t, TZ, 480)).toBe("2026-11-14");
  });

  it("12 · Gegenprüfung mit temporal-polyfill, alle 15 min 2026–2030", () => {
    let bad = 0, n = 0;
    for (let ms = Z("2026-01-01T00:00:00Z"); ms < Z("2031-01-01T00:00:00Z"); ms += 15 * MIN) {
      const zdt = Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(TZ);
      const p = localParts(ms, TZ);
      if (p.y !== zdt.year || p.m !== zdt.month || p.d !== zdt.day || p.h !== zdt.hour || p.mi !== zdt.minute) bad++;
      // Ortszeit → ms wie Temporal „compatible“
      const back = Temporal.PlainDateTime.from({ year: zdt.year, month: zdt.month, day: zdt.day, hour: zdt.hour, minute: zdt.minute })
        .toZonedDateTime(TZ, { disambiguation: "compatible" }).epochMilliseconds;
      if (fromLocal(TZ, zdt.year, zdt.month, zdt.day, zdt.hour, zdt.minute).ms !== back) bad++;
      n++;
    }
    expect(n).toBeGreaterThan(170_000);
    expect(bad).toBe(0);
    // Lücken-Zeiten wie Temporal „compatible“
    for (const [y, m, d] of [[2026, 3, 29], [2027, 3, 28], [2028, 3, 26], [2029, 3, 25], [2030, 3, 31]] as const) {
      const exp = Temporal.PlainDateTime.from({ year: y, month: m, day: d, hour: 2, minute: 30 }).toZonedDateTime(TZ, { disambiguation: "compatible" }).epochMilliseconds;
      const r = fromLocal(TZ, y, m, d, 2, 30);
      expect(r.gap).toBe(true);
      expect(r.ms).toBe(exp);
    }
  }, 60_000);

  it("13 · gleiche Ergebnisse mit TZ=UTC und TZ=America/New_York (Kern hängt nicht von der Rechner-Zeitzone ab)", () => {
    const run = () => {
      const ev = ev0([{ date: "2026-10-24", start: "22:00", end: "06:00", curfew: "05:00" }]);
      return JSON.stringify([ev.days[0]!.start, ev.days[0]!.end, ev.days[0]!.curfew, fromLocal(TZ, 2026, 3, 29, 2, 30), businessDate(Z("2026-11-14T01:00:00Z"), TZ, 480), localHM(Z("2026-07-01T12:00:00Z"), TZ)]);
    };
    const old = process.env.TZ;
    process.env.TZ = "UTC";
    const a = run();
    process.env.TZ = "America/New_York";
    const b = run();
    expect(new Date(Z("2026-07-01T12:00:00Z")).getHours()).toBe(8); // die Rechner-Zeitzone hat wirklich gewechselt
    process.env.TZ = old;
    expect(b).toBe(a);
  });
});
