// Dateien des Leitstands. Grundsatz (Konzept „Datenschutz“): ohne Zustimmung nichts auf die Platte – kein Autosave,
// keine „zuletzt geöffnet“-Liste mit Namen. Mit Zustimmung („Auf diesem Rechner sichern?“ = Ja) wird die Veranstaltung
// laufend gesichert (atomar: tmp + rename wie VJ-Link src/main/projectfile.ts) und beim nächsten Start wieder geöffnet.
// prefs.json enthält nur Programm-Einstellungen (Sprache, Darstellung, Startbildschirm, Suite-Netz) – nie Namen;
// den Pfad der letzten Veranstaltung nur, wenn für sie das Sichern erlaubt war.
// Datenordner: CREWLINK_DATA (Tests) oder der Electron-Benutzerordner.
import { promises as fsp, unlinkSync } from "node:fs";
import path from "node:path";
import { FILE_EXT, MAX_FILE_BYTES, parseEvent, serializeEvent, type CrewEvent } from "../core/model";
import type { Prefs } from "../shared/bridge";

export const DEFAULT_PREFS: Prefs = { lang: "de", theme: "night", showOnStart: true, intro: null, suiteNet: true, hideLauncherHint: false };

export async function writeAtomic(file: string, data: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, data, "utf8");
  await fsp.rename(tmp, file);
}

export class Storage {
  prefs: Prefs = { ...DEFAULT_PREFS };
  lastFile: string | null = null;
  private saveTimer?: NodeJS.Timeout;
  private pending?: { ev: CrewEvent; file: string };

  constructor(readonly dir: string) {}

  get prefsFile(): string { return path.join(this.dir, "prefs.json"); }
  /** Laufende Sicherung ohne eigene Datei: im Datenordner, Name = Kennung (nicht der Name der Veranstaltung). */
  autoFile(ev: CrewEvent): string { return path.join(this.dir, "veranstaltungen", `${ev.id}.${FILE_EXT}`); }

  async init(lang: "de" | "en"): Promise<void> {
    this.prefs.lang = lang;
    try {
      const raw = JSON.parse(await fsp.readFile(this.prefsFile, "utf8")) as Record<string, unknown>;
      if (raw.lang === "de" || raw.lang === "en") this.prefs.lang = raw.lang;
      if (raw.theme === "day" || raw.theme === "night" || raw.theme === "system") this.prefs.theme = raw.theme;
      if (typeof raw.showOnStart === "boolean") this.prefs.showOnStart = raw.showOnStart;
      // eigener Wert „Startanimation zeigen“ (Merker own.intro); ohne Merker gilt die Suite
      const own = raw.own && typeof raw.own === "object" ? (raw.own as Record<string, unknown>) : {};
      if (typeof own.intro === "boolean") this.prefs.intro = own.intro;
      if (typeof raw.suiteNet === "boolean") this.prefs.suiteNet = raw.suiteNet;
      if (typeof raw.hideLauncherHint === "boolean") this.prefs.hideLauncherHint = raw.hideLauncherHint;
      if (typeof raw.lastFile === "string" && raw.lastFile.endsWith(`.${FILE_EXT}`)) this.lastFile = raw.lastFile;
    } catch { /* erster Start */ }
  }

  /** Einstellungen sichern (nur wenn sie vom Standard abweichen oder eine Datei gemerkt ist). */
  async savePrefs(): Promise<void> {
    const same = JSON.stringify(this.prefs) === JSON.stringify({ ...DEFAULT_PREFS, lang: this.prefs.lang });
    if (same && !this.lastFile) {
      try { await fsp.unlink(this.prefsFile); } catch { /* gab es nicht */ }
      return;
    }
    const { intro, ...rest } = this.prefs;
    await writeAtomic(this.prefsFile, JSON.stringify({ ...rest, ...(intro !== null ? { own: { intro } } : {}), ...(this.lastFile ? { lastFile: this.lastFile } : {}) }, null, 1));
  }

  /** Letzte gesicherte Veranstaltung (nur wenn ihr Sichern erlaubt war). */
  async loadLast(): Promise<{ ev: CrewEvent; file: string } | null> {
    if (!this.lastFile) return null;
    const r = await this.read(this.lastFile);
    if (!r.ok || !r.event.consent.save) return null;
    return { ev: r.event, file: this.lastFile };
  }

  async read(file: string): Promise<{ ok: true; event: CrewEvent } | { ok: false; error: string }> {
    try {
      const st = await fsp.stat(file);
      if (st.size > MAX_FILE_BYTES) return { ok: false, error: "size" };
      const r = parseEvent(await fsp.readFile(file, "utf8"));
      return r.ok ? { ok: true, event: r.value } : { ok: false, error: r.error };
    } catch (e) { return { ok: false, error: (e as NodeJS.ErrnoException).code ?? "read" }; }
  }

  /** Laufende Sicherung (mit Zustimmung). Gebündelt, 600 ms nach der letzten Änderung. */
  autosave(ev: CrewEvent | null, file: string | null, onError: (e: string | null) => void): void {
    if (!ev || ev.demo || !ev.consent.save) { this.pending = undefined; clearTimeout(this.saveTimer); return; }
    this.pending = { ev, file: file ?? this.autoFile(ev) };
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { void this.flush().then(() => onError(null), e => onError(String((e as NodeJS.ErrnoException).code ?? e))); }, 600);
  }

  async flush(): Promise<string | null> {
    const p = this.pending;
    this.pending = undefined;
    clearTimeout(this.saveTimer);
    if (!p || p.ev.demo || !p.ev.consent.save) return null;
    await writeAtomic(p.file, serializeEvent(p.ev));
    if (this.lastFile !== p.file) { this.lastFile = p.file; await this.savePrefs(); }
    return p.file;
  }

  async write(ev: CrewEvent, file: string): Promise<void> {
    await writeAtomic(file, serializeEvent(ev));
    this.lastFile = file;
    await this.savePrefs();
  }

  /** Ohne Zustimmung: Verweis auf eine frühere Datei vergessen. */
  async forget(): Promise<void> {
    if (!this.lastFile) return;
    this.lastFile = null;
    await this.savePrefs();
  }
}

/** Gemeinsame Einstellung der Suite: `intro` aus Link-Suite/suite.json (nur lesen). Fehlt oder kaputt → true. */
export async function readSuiteIntro(appData: string): Promise<boolean> {
  try {
    const raw = JSON.parse(await fsp.readFile(path.join(appData, "Link-Suite", "suite.json"), "utf8")) as Record<string, unknown>;
    return raw && typeof raw === "object" && typeof raw.intro === "boolean" ? raw.intro : true;
  } catch { return true; }
}

/**
 * Absturz erkennen (EINBAU.md §5): `running.lock` beim Start anlegen, beim sauberen Beenden löschen. Liegt sie beim
 * Start schon da, ist der letzte Lauf abgestürzt. Inhalt nur Prozessnummer und Zeit – keine Namen.
 */
export class RunLock {
  crashed = false;
  constructor(private readonly dir: string) {}
  get file(): string { return path.join(this.dir, "running.lock"); }
  async acquire(): Promise<void> {
    try { await fsp.access(this.file); this.crashed = true; } catch { this.crashed = false; }
    try { await writeAtomic(this.file, JSON.stringify({ pid: process.pid, at: Date.now() })); } catch { /* ohne Speicher weiter */ }
  }
  release(): void {
    try { unlinkSync(this.file); } catch { /* schon weg */ }
  }
}
