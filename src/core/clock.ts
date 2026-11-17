// Hausuhr (RECHERCHE §1): der Leitstand gibt die Zeit vor, alle anderen gleichen sich daran ab.
// - HouseClock: Leitstand. Monotone Uhr als Takt, Systemuhr nur als Anker. Springt die Systemuhr um mehr als 2 s,
//   wird gefragt („Uhr springt um 47 s – übernehmen?“), bis dahin läuft die Hausuhr frei weiter.
// - ClockSync: Browser (und Leitstand-Oberfläche). NTP-artig mit vier Zeitstempeln über WebSocket/IPC; die Probe mit
//   der kürzesten Laufzeit zählt; kleine Korrekturen gleiten (höchstens 0,1 s je s), nie sichtbar rückwärts.
// Beide ohne eigene Uhrzugriffe (Uhren werden übergeben) – dadurch testbar.

/** Abweichung, ab der die Systemuhr als „gesprungen“ gilt. */
export const JUMP_MS = 2000;
/** Gleiten: höchstens 0,1 s je Sekunde (10 % schneller oder langsamer). */
export const SLEW_RATE = 0.1;

export class HouseClock {
  private anchorWall: number;
  private anchorMono: number;
  private corr = 0;
  private lastMono: number;
  /** Erkannter Sprung, auf Antwort wartend (ms, positiv = Systemuhr ist vorgegangen). */
  pendingJump: number | null = null;
  /** „Gleiten lassen“ gewählt: auch große Abweichungen gleiten. */
  private gliding = false;

  constructor(private readonly mono: () => number, private readonly wall: () => number) {
    this.anchorWall = wall();
    this.anchorMono = mono();
    this.lastMono = this.anchorMono;
  }

  now(): number { return this.anchorWall + (this.mono() - this.anchorMono) + this.corr; }

  /** Abweichung Systemuhr − Hausuhr (ms). */
  drift(): number { return this.wall() - this.now(); }

  /** Jede Sekunde aufrufen. Gibt einen neu erkannten Sprung zurück (dann fragen). */
  tick(): number | null {
    const m = this.mono();
    const dt = Math.max(0, m - this.lastMono);
    this.lastMono = m;
    const d = this.drift();
    if (this.pendingJump !== null) { this.pendingJump = d; return null; }
    if (Math.abs(d) > JUMP_MS && !this.gliding) { this.pendingJump = d; return d; }
    const step = Math.min(Math.abs(d), SLEW_RATE * dt);
    this.corr += Math.sign(d) * step;
    if (this.gliding && Math.abs(d) - step <= 1) this.gliding = false;
    return null;
  }

  /** „Übernehmen“: Hausuhr springt auf die Systemuhr. */
  accept(): void { this.reanchor(); }
  /** „Gleiten lassen“: Hausuhr gleitet hinüber (0,1 s je s). */
  glide(): void { this.pendingJump = null; this.gliding = true; }
  /** Nach dem Ruhezustand (powerMonitor „resume“): ohne Frage neu ankern. */
  reanchor(): void {
    this.anchorWall = this.wall();
    this.anchorMono = this.mono();
    this.lastMono = this.anchorMono;
    this.corr = 0;
    this.pendingJump = null;
    this.gliding = false;
  }
}

/**
 * Nur Screenshots (`--shot` mit `CREWLINK_SHOT_AT=<ISO-Zeit>`): Versatz (ms), um den die Systemuhr für die Hausuhr
 * verschoben wird, damit Demo, Leitstand, Uhr-Fenster und Browser-Seiten diese Zeit zeigen (z. B. eine Nacht für die
 * Website-Bilder, egal wann der Lauf ist). Ohne `--shot`, ohne Wert oder bei ungültigem Wert: 0 (keine Wirkung).
 * Erlaubt ist nur ISO 8601 mit Datum, Uhrzeit und Zone (`Z` oder `±hh:mm`), z. B. `2026-11-16T01:17:00+01:00`.
 */
export function shotClockOffset(value: string | undefined, shot: boolean, wallNow: number): number {
  if (!shot || !value) return 0;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value.trim())) return 0;
  const at = Date.parse(value.trim());
  return Number.isFinite(at) && Number.isFinite(wallNow) ? at - wallNow : 0;
}

export interface ClockSample { offset: number; delay: number; at: number }

export const PROBE_MAX_DELAY = 500;
export const PROBE_POOR_DELAY = 200;
export const SAMPLE_WINDOW = 16;
export const SAMPLE_MAX_AGE = 5 * 60_000;
export const SLEW_LIMIT = 1000;
export const FIRST_PROBES = 8;
export const FIRST_PROBE_GAP = 100;
export const REPEAT_PROBES = 4;
export const REPEAT_EVERY = 30_000;

/**
 * Zeitabgleich im Browser. `t1`/`t4` sind performance.now() beim Senden/Empfangen, `r`/`s` die Hausuhr beim Empfang
 * bzw. Senden im Leitstand. Versatz θ = ½·[(r − t1) + (s − t4)], Laufzeit δ = (t4 − t1) − (s − r) (RFC 5905).
 */
export class ClockSync {
  private samples: ClockSample[] = [];
  private applied: number | null = null;
  private target = 0;
  private lastPerf = 0;
  /** Hausuhr − Date.now() zuletzt (Rückfall nach Schlaf ohne Netz). */
  wallOffset: number | null = null;
  /** performance.now() der letzten gültigen Probe */
  lastSampleAt: number | null = null;

  add(t1: number, r: number, s: number, t4: number, wallNow?: number): boolean {
    const delay = (t4 - t1) - (s - r);
    if (!Number.isFinite(delay) || delay < 0 || delay > PROBE_MAX_DELAY) return false;
    const offset = ((r - t1) + (s - t4)) / 2;
    this.samples.push({ offset, delay, at: t4 });
    this.samples = this.samples.filter(x => t4 - x.at <= SAMPLE_MAX_AGE).slice(-SAMPLE_WINDOW);
    const best = this.best()!;
    this.target = best.offset;
    if (this.applied === null || Math.abs(this.target - this.applied) > SLEW_LIMIT) { this.applied = this.target; }
    this.lastPerf = Math.max(this.lastPerf, t4);
    this.lastSampleAt = t4;
    if (wallNow !== undefined) this.wallOffset = this.now(t4) - wallNow;
    return true;
  }

  best(): ClockSample | undefined {
    let b: ClockSample | undefined;
    for (const x of this.samples) if (!b || x.delay <= b.delay) b = x; // gleich gut: die neuere zählt
    return b;
  }

  get synced(): boolean { return this.applied !== null; }
  /** Genauigkeit ± (halbe kürzeste Laufzeit). */
  get accuracy(): number | null { const b = this.best(); return b ? b.delay / 2 : null; }
  /** Beste Laufzeit > 200 ms: „Zeit ungenau“. */
  get poor(): boolean { const b = this.best(); return !!b && b.delay > PROBE_POOR_DELAY; }

  /** Hausuhr zur performance.now()-Zeit `perf`. Gleitet zum Ziel (höchstens 0,1 s je s), springt nie rückwärts. */
  now(perf: number): number {
    if (this.applied === null) return perf;
    const dt = Math.max(0, perf - this.lastPerf);
    if (dt > 0) {
      const diff = this.target - this.applied;
      const step = Math.min(Math.abs(diff), SLEW_RATE * dt);
      this.applied += Math.sign(diff) * step;
      this.lastPerf = perf;
    }
    return perf + this.applied;
  }

  /** Nach Schlaf ohne neue Messung: Versatz aus der Wanduhr wiederherstellen (performance.now() stand evtl. still). */
  recoverFromWall(perf: number, wallNow: number): void {
    if (this.wallOffset === null) return;
    const house = wallNow + this.wallOffset;
    this.applied = house - perf;
    this.target = this.applied;
    this.samples = [];
    this.lastPerf = perf;
  }

  reset(): void { this.samples = []; this.applied = null; }
}

/** Wartezeit bis zum nächsten Sekundenwechsel der Hausuhr (Anzeige auf allen Geräten gleichzeitig). */
export function msToNextSecond(house: number): number {
  const r = 1000 - (((house % 1000) + 1000) % 1000);
  return r < 15 ? r + 1000 : r;
}
