// Schmale Brücke zwischen Oberfläche (Leitstand, Fenster „Große Uhr“) und Hauptprozess. Nur benannte Funktionen;
// der Hauptprozess prüft jedes Argument.
import type { CrewEvent, CrewTemplate } from "../core/model";
import type { ChatState } from "../core/suitechat";
import type { WebPlan } from "../core/plan";
import type { WebStatus } from "../main/webserver";

export type Theme = "day" | "night" | "system";
/** `intro`: eigener Wert des Programms (Merker own.intro); null = „Wie die Suite“ (suite.json → intro). */
export interface Prefs { lang: "de" | "en"; theme: Theme; showOnStart: boolean; intro: boolean | null; suiteNet: boolean; /** Karte „Link-Suite laden“: „Nicht mehr zeigen“ */ hideLauncherHint: boolean }

export interface AppState {
  version: string;
  event: CrewEvent | null;
  rev: number;
  /** Datei der Veranstaltung (nur mit Zustimmung zum Sichern) */
  file: string | null;
  /** Speicherfehler (Platte voll …) */
  saveError: string | null;
  privacy: boolean;
  web: WebStatus;
  /** IPv4-Adressen dieses Rechners im Netz (für QR und Anzeige) */
  addresses: string[];
  suite: { on: boolean; listening: boolean; error?: string; port: number; peers: number };
  prefs: Prefs;
  changed: Record<string, number>;
  /** Startoptionen (Demo, Screenshots) */
  flags: { demo: boolean; shot: boolean; reducedIntro: boolean; /** --hint: Karte „Link-Suite laden“ auch in Demo/Screenshots */ hint: boolean };
  /** Wert `intro` aus der gemeinsamen suite.json (nur gelesen; fehlt → true) */
  suiteIntro: boolean;
  clockJump: number | null;
  /** Andere Leitstände im Netz (fremdes `here` mit role "lead"). `weFirst`: dieser Leitstand war zuerst da und gilt. */
  otherLeads: { address: string; http: string; weFirst: boolean }[];
  /** Geöffnete Veranstaltung hatte die Weboberfläche an: erst fragen */
  askWeb: boolean;
}

export type FileResult = { ok: true; file?: string } | { ok: false; error: string };

export interface CrewBridge {
  getState(): Promise<AppState>;
  /** Startanimation: nur beim ersten Laden des Hauptfensters je Programmstart true (Hauptprozess entscheidet). */
  introTake(): Promise<{ enabled: boolean; holdAt: number | null; reduced: boolean | null }>;
  onState(cb: (s: AppState) => void): void;
  /** Neue Fassung der Veranstaltung (Leitstand ist Leitung). `changed`: Slots mit Programmänderung (GEÄNDERT). */
  setEvent(ev: CrewEvent | null, changed?: string[]): Promise<{ ok: boolean; rev: number; error?: string }>;
  demo(): Promise<void>;
  fileOpen(): Promise<FileResult & { event?: CrewEvent }>;
  fileSave(as: boolean): Promise<FileResult>;
  templateSave(t: CrewTemplate): Promise<FileResult>;
  templateOpen(): Promise<{ ok: boolean; template?: CrewTemplate; error?: string }>;
  setWeb(on: boolean, port?: number): Promise<WebStatus>;
  /** Frage „Weboberfläche einschalten?“ beantwortet (ohne Einschalten) */
  webAskDone(): void;
  setPrefs(p: Partial<Prefs>): Promise<Prefs>;
  setPrivacy(on: boolean): void;
  clockPing(): Promise<{ r: number; s: number }>;
  clockAnswer(accept: boolean): void;
  openClock(floor: string): void;
  openNetLink(): void;
  chatGet(since: number): Promise<ChatState | null>;
  chatPost(text: string, urgent: boolean): Promise<boolean>;
  chatProfile(nick: string, where: string): Promise<ChatState | null>;
  chatAttention(): void;
  onChat(cb: () => void): void;
  /** Fenster „Große Uhr“: gefilterter Plan */
  onPlan(cb: (p: WebPlan | null) => void): void;
  getPlan(): Promise<WebPlan | null>;
  /** Befehle aus dem Programmmenü (Neu, Öffnen, Speichern …) */
  onMenu(cb: (cmd: string) => void): void;
  /** Ist der Launcher Link-Suite installiert? Lokal geprüft im Hauptprozess; null = unbekannt. Ohne Pfad. */
  suiteLauncher(): Promise<{ installed: boolean; version?: string } | null>;
  /** Öffnet die feste Seite der Link-Suite im Browser (Hauptprozess, shell.openExternal) – kein Argument */
  openLauncherPage(): void;
  onSuiteLauncher(cb: (l: { installed: boolean; version?: string } | null) => void): void;
  platform: string;
}

declare global { interface Window { crew?: CrewBridge } }
