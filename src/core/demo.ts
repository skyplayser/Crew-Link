// Demo-Veranstaltung „Wochenende Club Beispiel“ – relativ zur aktuellen Hausuhr erzeugt, damit beim Start sofort:
// auf Main ein Set läuft (noch gut 10 min, danach Kira bereit), im Keller ein Set überzogen ist (Übergabe offen),
// die Terrasse ihr Floor-Ende schon hinter sich hat und die Sperrstunde in etwa 2 h ist. Zwei Tage, drei Floors.
// Die Demo wird nie gespeichert (demo: true, keine Zustimmung zum Sichern).
import { newEvent, type CrewEvent, type Slot, type SlotKind } from "./model";
import { addDays, businessDate, dayTime, HOUR, localMinutes, localParts, MIN } from "./zeit";

const f5 = (ms: number) => Math.floor(ms / (5 * MIN)) * 5 * MIN;
const c5 = (ms: number) => Math.ceil(ms / (5 * MIN)) * 5 * MIN;

const WD = { de: ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"], en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] };

export function makeDemo(now: number, lang: "de" | "en" = "de", tz = "Europe/Berlin"): CrewEvent {
  const C = c5(now + 2 * HOUR + 10 * MIN);      // Sperrstunde in 2:10–2:15
  const S = C - 7 * HOUR;                        // Beginn des Betriebs
  const E = C + HOUR;                            // Ende des Betriebs
  const dayChange = Math.floor(localMinutes(S - 4 * HOUR, tz) / 60) * 60;
  const date1 = businessDate(S, tz, dayChange);
  const date2 = addDays(date1, 1);
  const weekday = (date: string) => { const [y, m, d] = date.split("-").map(Number); return WD[lang][new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]!; };
  const hm = (ms: number) => { const m = localMinutes(ms, tz); return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
  const ev = newEvent({
    name: lang === "de" ? "Wochenende Club Beispiel" : "Weekend Club Example", place: lang === "de" ? "Club Beispiel, Leipzig" : "Club Example, Leipzig",
    tz, dayChange,
    days: [
      { date: date1, label: weekday(date1), start: hm(S), end: hm(E), curfew: hm(C) },
      { date: date2, label: weekday(date2), start: hm(S), end: hm(E), curfew: hm(C) },
    ],
    floors: ["Main", "Keller", "Terrasse"], consent: { save: false, log: false }, now,
  });
  ev.demo = true;
  ev.settings.handover = "confirm";
  const [main, keller, terr] = ev.floors as [typeof ev.floors[0], typeof ev.floors[0], typeof ev.floors[0]];
  main.id = "main"; keller.id = "keller"; terr.id = "terrasse";
  const [d1, d2] = ev.days as [typeof ev.days[0], typeof ev.days[0]];
  d1.id = "d1"; d2.id = "d2";
  for (const d of ev.days) d.floors = { main: { open: true }, keller: { open: true }, terrasse: { open: true } };
  const slots: Slot[] = [];
  let n = 0;
  const add = (day: string, floor: string, name: string, start: number, end: number, o: { kind?: SlotKind; pub?: string; note?: string; handover?: number; readyAt?: number } = {}) => {
    slots.push({ id: `s${++n}`, day, floor, name, public: o.pub ?? "", kind: o.kind ?? "dj", start, end, note: o.note ?? "",
      ...(o.handover !== undefined ? { handover: o.handover } : {}), ...(o.readyAt !== undefined ? { readyAt: o.readyAt } : {}) });
  };
  // ---- Tag 1 (läuft)
  const N1 = c5(now + 10 * MIN), N0 = N1 - 2 * HOUR;
  add("d1", "main", "Lena Sol", S, S + 2 * HOUR, { handover: S });
  add("d1", "main", "Marek", S + 2 * HOUR, N0, { handover: S + 2 * HOUR });
  add("d1", "main", "Nova", N0, N1, { handover: N0 + 30_000, note: lang === "de" ? "Bringt eigenen Controller, Kanal 3+4" : "Brings own controller, channel 3+4" });
  add("d1", "main", "Kira", N1, C, { readyAt: f5(now - 5 * MIN), note: lang === "de" ? "USB an CDJ 3+4" : "USB on CDJ 3+4" });
  d1.floors.keller = { open: true };
  const T1 = f5(now - 5 * MIN), T0 = T1 - 70 * MIN;
  add("d1", "keller", "Duo Pulse B2B", S + HOUR, T0, { kind: "b2b", handover: S + HOUR });
  add("d1", "keller", "Tom Riva", T0, T1, { handover: T0 });
  add("d1", "keller", "Mara Lux", T1, C, { pub: "Special Guest", note: lang === "de" ? "Secret Guest – Name nicht öffentlich" : "Secret guest – name not public" });
  const FE = S + 3 * HOUR;
  d1.floors.terrasse = { open: true, end: FE };
  add("d1", "terrasse", "Sunny K", S, S + 2 * HOUR, { handover: S });
  add("d1", "terrasse", lang === "de" ? "Umbau" : "Changeover", S + 2 * HOUR, S + 2 * HOUR + 30 * MIN, { kind: "changeover" });
  add("d1", "terrasse", "Aurora", S + 2 * HOUR + 30 * MIN, FE, { kind: "live" });
  // ---- Tag 2 (gleiche Ortszeiten, neu umgerechnet)
  const at = (ms: number) => { const p = localParts(ms, tz); return dayTime(tz, date2, p.h * 60 + p.mi, dayChange).ms; };
  const S2 = d2.start, C2 = d2.curfew!;
  d2.floors.terrasse = { open: true, end: at(FE) };
  add("d2", "main", "Jay Moreno", S2, S2 + 2 * HOUR);
  add("d2", "main", "Nova", S2 + 2 * HOUR, S2 + 4 * HOUR);
  add("d2", "main", "Kira b2b Lena", S2 + 4 * HOUR, C2, { kind: "b2b" });
  add("d2", "keller", "Pulse Collective", S2 + HOUR, S2 + 4 * HOUR);
  add("d2", "keller", "Ravi", S2 + 4 * HOUR, C2, { pub: "Special Guest" });
  add("d2", "terrasse", "Sunny K", S2, S2 + 2 * HOUR);
  add("d2", "terrasse", "Aurora", S2 + 2 * HOUR, at(FE), { kind: "live" });
  ev.slots = slots;
  return ev;
}
