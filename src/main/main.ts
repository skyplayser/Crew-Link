// Crew Link – Hauptprozess (Leitstand). Hält die Veranstaltung, die Hausuhr, die Weboberfläche (ab Werk aus) und den
// Suite-Netz-Adapter. Fenster wie VJ-Link src/main/main.ts: contextIsolation, sandbox, keine Navigation, kein window.open.
import { BrowserWindow, Menu, app, dialog, ipcMain, nativeImage, powerMonitor, powerSaveBlocker, screen, session, shell, type MenuItemConstructorOptions } from "electron";
import path from "node:path";
import { existsSync, promises as fsp } from "node:fs";
import { performance } from "node:perf_hooks";
import { HouseClock, shotClockOffset } from "../core/clock";
import { eventFromObject, FILE_EXT, parseTemplate, TEMPLATE_EXT, type CrewEvent } from "../core/model";
import { crewHere, crewTick, CREW_HERE_EVERY_MS, ipv4, LeadWatch } from "../core/net";
import { planFor, CHANGED_MS, type Viewer } from "../core/plan";
import { makeDemo } from "../core/demo";
import { dayView } from "../core/countdown";
import { setLang, t } from "../core/i18n";
import { SuiteNet, TEST_PORT, adapters, SUITE_PORT } from "./suitenet";
import { ChatNet } from "./chatnet";
import { WebServer } from "./webserver";
import { readSuiteIntro, RunLock, Storage, writeAtomic } from "./storage";
import { detectLauncher, type LauncherInfo } from "./suite/launcher-detect";
import { runShots } from "./shots";
import type { AppState, Prefs } from "../shared/bridge";

declare const APP_VERSION: string;
const VERSION = typeof APP_VERSION === "string" ? APP_VERSION : "0.0.0";

// ------------------------------------------------------------------ Startoptionen
const argv = process.argv.slice(1);
const flag = (name: string) => argv.includes(name);
const opt = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
/** `--name=wert` oder `--name wert` */
const optEq = (name: string) => { const a = argv.find(x => x.startsWith(`${name}=`)); return a ? a.slice(name.length + 1) : opt(name); };
const HELP = `Crew Link – Startoptionen
  --demo                 Demo-Veranstaltung (zwei Tage, drei Floors), speichert nichts
  --web-on               Weboberfläche gleich einschalten
  --port <n>             Port der Weboberfläche für die Demo (Standard 8070)
  --lang de|en           Sprache erzwingen
  --no-intro, --no-anim  ohne Startanimation
  --shot <ordner>        Screenshots für die QA, danach beenden (zeigt nie eine Animation, außer mit --intro=)
  --intro=<ms>[,<ms>…]   nur mit --shot: Bildfolge der Startanimation (Alias: --intro-at <ms,…>)
  --shot-address <ip>    nur mit --shot/--demo: angezeigte Adresse ersetzen (nur Anzeige, nicht das Binden)
  --hint                 Karte „Link-Suite laden“ auch in Demo/Screenshots zeigen
  --launcher=installed|missing  nur mit --shot: Erkennung des Launchers vortäuschen
  CREWLINK_SHOT_AT=<ISO-Zeit>   (Umgebung) nur mit --shot: Hausuhr auf diese Zeit stellen, z. B. 2026-11-16T01:17:00+01:00
  --help                 diese Hilfe`;
if (flag("--help") || flag("-h")) { console.log(HELP); process.exit(0); }
const FLAGS = {
  demo: flag("--demo"),
  webOn: flag("--web-on"),
  port: Number(opt("--port")) || 0,
  shot: opt("--shot") ?? null,
  lang: opt("--lang") === "en" ? "en" as const : opt("--lang") === "de" ? "de" as const : null,
  noIntro: flag("--no-intro") || flag("--no-anim"),
  /** Nur Screenshots: Startanimation als Bildfolge (ms, Komma-Liste), gemeinsamer Name --intro=<ms>[,<ms>…], Alias --intro-at */
  introAt: (optEq("--intro") ?? optEq("--intro-at") ?? "").split(",").filter(x => x.trim() !== "").map(Number).filter(n => Number.isFinite(n) && n >= 0 && n <= 5000),
  shotAddress: opt("--shot-address") ?? null,
  /** Karte „Link-Suite laden“ auch in Demo/Screenshots zeigen (EINBAU §3: nur mit eigenem Schalter) */
  hint: flag("--hint"),
  /** nur mit --shot: Erkennung des Launchers vortäuschen (installed | missing) */
  launcherSim: optEq("--launcher") ?? null,
};
/**
 * Nur für Screenshots: angezeigte Adresse (Startbildschirm, ROLLEN, QR-Inhalt) ersetzen, damit keine echte LAN-Adresse
 * veröffentlicht wird. Wirkt nur mit --shot oder --demo, nur gültiges IPv4; Binden des Servers und `here` bleiben echt.
 */
const SHOW_ADDRESS = FLAGS.shotAddress && (FLAGS.shot || FLAGS.demo) && ipv4(FLAGS.shotAddress) !== null && /^\d{1,3}(\.\d{1,3}){3}$/.test(FLAGS.shotAddress) ? FLAGS.shotAddress : null;
if (FLAGS.shotAddress && !SHOW_ADDRESS) console.warn("--shot-address ignoriert (nur gültiges IPv4, nur mit --shot oder --demo)");

if (process.env.CREWLINK_DATA) app.setPath("userData", path.resolve(process.env.CREWLINK_DATA));
app.setName("Crew Link");
// Nur ein Leitstand je Rechner (Port 8070, Suite-Netz). Für Tests mit eigenem Datenordner nicht.
if (!process.env.CREWLINK_DATA && !FLAGS.shot && !app.requestSingleInstanceLock()) app.exit(0);

const ICON_FILE = path.join(__dirname, "..", "icon.png");
const ICON = existsSync(ICON_FILE) ? ICON_FILE : undefined;
const rendererFile = (name: string) => path.join(__dirname, "..", "renderer", name);

let main: BrowserWindow | null = null;
/** Startanimation: nur beim ersten Laden des Hauptfensters je Programmstart (nicht nach ⌘R, nicht nach Absturz). */
let introTaken = false;
let suiteIntro = true;
let runLock: RunLock;
/** Launcher Link-Suite (lokale Erkennung, nichts ins Netz, nichts geschrieben). Die Oberfläche bekommt keinen Pfad. */
let launcher: LauncherInfo | null = null;
const SUITE_PAGE = "https://skyplayser.github.io/Link-Suite/";
const SOURCE_URL = "https://github.com/skyplayser/Crew-Link";
async function detectSuiteLauncher(search = true): Promise<LauncherInfo | null> {
  if (FLAGS.shot && (FLAGS.launcherSim === "installed" || FLAGS.launcherSim === "missing")) return { installed: FLAGS.launcherSim === "installed", via: "path", ms: 0 };
  try { return await detectLauncher({ search }); } catch { return null; }
}
const launcherForUi = (l: LauncherInfo | null) => (l ? { installed: l.installed, ...(l.version ? { version: l.version } : {}) } : null);
const clocks = new Map<string, BrowserWindow>();
let storage: Storage;
let event: CrewEvent | null = null;
let file: string | null = null;
let rev = 1;
let privacy = false;
let saveError: string | null = null;
const changed: Record<string, number> = {};
/** Nur mit --shot: Hausuhr auf CREWLINK_SHOT_AT verschieben (Website-Bilder bei Nacht); sonst 0, keine Wirkung. */
const SHOT_SHIFT = shotClockOffset(process.env.CREWLINK_SHOT_AT, !!FLAGS.shot, Date.now());
if (process.env.CREWLINK_SHOT_AT && FLAGS.shot && !SHOT_SHIFT) console.warn("CREWLINK_SHOT_AT ignoriert (ISO-Zeit mit Zone, z. B. 2026-11-16T01:17:00+01:00)");
const house = new HouseClock(() => performance.now(), () => Date.now() + SHOT_SHIFT);
let jump: number | null = null;
let suite: SuiteNet | null = null;
let chat: ChatNet | null = null;
let web: WebServer;
let hereTimer: NodeJS.Timeout | undefined, tickTimer: NodeJS.Timeout | undefined;
/** Andere Leitstände (Konzept „Zwei Leitstände im Netz“). */
let leads: LeadWatch | null = null;
let leadsDirty = false;
/** Eine geöffnete Datei hatte die Weboberfläche an: nicht ohne Frage einschalten. */
let askWeb = false;

// ------------------------------------------------------------------ Fenster

function secureWindow(opts: Electron.BrowserWindowConstructorOptions): BrowserWindow {
  const win = new BrowserWindow({
    backgroundColor: "#0C0E13", ...(ICON ? { icon: ICON } : {}), ...opts,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, ...(opts.webPreferences ?? {}) },
  });
  win.webContents.on("will-navigate", e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  return win;
}

function createMain(): void {
  const wa = screen.getPrimaryDisplay().workArea;
  const width = FLAGS.shot ? 1600 : Math.min(1600, Math.round(wa.width * 0.92)), height = FLAGS.shot ? 1000 : Math.min(1000, Math.round(wa.height * 0.92));
  main = secureWindow({ width, height, minWidth: 980, minHeight: 640, title: "Crew Link", show: !FLAGS.shot, ...(FLAGS.shot ? { x: 0, y: 0 } : {}) });
  void main.loadFile(rendererFile("index.html"), { query: FLAGS.shot ? { shot: "1" } : {} });
  // zurück ins Fenster: neu prüfen (gerade installiert → Karte weg); ohne Spotlight/Registry, schnell
  // Schnelle Neu-Prüfung ohne Spotlight: übernimmt nur „installiert“ und fällt nie auf „nicht installiert“ zurück, sonst
  // überschriebe sie das Ergebnis der ersten Prüfung mit Spotlight-Rückfall (QA Runde 4, Nr. 30).
  main.on("focus", () => { void detectSuiteLauncher(false).then(l => { if (l?.installed) launcher = l; if (main && !main.isDestroyed()) main.webContents.send("suite:launcher", launcherForUi(launcher)); }); });
  if (process.env.CREWLINK_DEBUG) main.webContents.on("console-message", e => console.log(`[ui] ${e.level} ${e.message}`));
  main.on("closed", () => { main = null; for (const w of clocks.values()) if (!w.isDestroyed()) w.close(); });
  main.webContents.on("render-process-gone", (_e, d) => {
    if (d.reason === "clean-exit" || !main) return;
    setTimeout(() => { if (main && !main.isDestroyed()) main.webContents.reload(); }, 500);
  });
}

/** Große Uhr als eigenes Fenster (auf einen zweiten Bildschirm ziehbar). Ohne Startanimation. */
function openClock(floor: string, o: { show?: boolean; width?: number; height?: number } = {}): BrowserWindow | null {
  if (!event || !event.floors.some(f => f.id === floor)) return null;
  const old = clocks.get(floor);
  if (old && !old.isDestroyed()) { old.show(); old.focus(); return old; }
  const win = secureWindow({ width: o.width ?? 1280, height: o.height ?? 720, minWidth: 480, minHeight: 270, title: `Crew Link · ${t("tab.clock")}`, show: o.show !== false });
  win.setMenuBarVisibility(false);
  void win.loadFile(rendererFile("clock.html"), { query: { floor } });
  clocks.set(floor, win);
  win.on("closed", () => { clocks.delete(floor); keepAwake(); });
  keepAwake();
  return win;
}

let displayBlock: number | null = null, appBlock: number | null = null;
/** Große Uhr offen: Bildschirm bleibt an. Weboberfläche an: Rechner schläft nicht ein (wie LJ Link caffeinate -i). */
function keepAwake(): void {
  const needDisplay = [...clocks.values()].some(w => !w.isDestroyed());
  if (needDisplay && displayBlock === null) displayBlock = powerSaveBlocker.start("prevent-display-sleep");
  if (!needDisplay && displayBlock !== null) { powerSaveBlocker.stop(displayBlock); displayBlock = null; }
  const needApp = web?.on;
  if (needApp && appBlock === null) appBlock = powerSaveBlocker.start("prevent-app-suspension");
  if (!needApp && appBlock !== null) { powerSaveBlocker.stop(appBlock); appBlock = null; }
}

// ------------------------------------------------------------------ Zustand

function addresses(): string[] {
  const list = adapters().map(a => a.address);
  return list.length ? list : ["127.0.0.1"];
}

function state(): AppState {
  return {
    version: VERSION, event, rev, file, saveError, privacy, web: web.status(), addresses: SHOW_ADDRESS ? [SHOW_ADDRESS] : addresses(),
    suite: { on: storage.prefs.suiteNet, listening: !!suite?.listening, ...(suite?.error ? { error: suite.error } : {}), port: suite?.port ?? SUITE_PORT, peers: chat?.state(Number.MAX_SAFE_INTEGER).peers.length ?? 0 },
    prefs: { ...storage.prefs }, changed: { ...changed },
    flags: { demo: !!event?.demo, shot: !!FLAGS.shot, reducedIntro: FLAGS.noIntro || !!FLAGS.shot, hint: FLAGS.hint },
    suiteIntro,
    clockJump: jump,
    otherLeads: leads?.list() ?? [],
    askWeb,
  };
}

let stateTimer: NodeJS.Timeout | undefined;
function pushState(): void {
  if (stateTimer) return;
  stateTimer = setTimeout(() => {
    stateTimer = undefined;
    if (main && !main.isDestroyed()) main.webContents.send("state", state());
    keepAwake();
  }, 30);
}

function planOf(viewer: Viewer) {
  if (!event) return null;
  const now = house.now();
  for (const [k, at] of Object.entries(changed)) if (now - at > CHANGED_MS) delete changed[k];
  return planFor(event, viewer, { rev, privacy, changed, now });
}

function pushPlans(): void {
  for (const w of clocks.values()) if (!w.isDestroyed()) w.webContents.send("plan", planOf("clock"));
  web.broadcastPlan();
}

/** Neue Fassung übernehmen (geprüft wie eine Datei). */
async function setEvent(raw: unknown, changedSlots: unknown): Promise<{ ok: boolean; rev: number; error?: string }> {
  if (raw === null) {
    event = null; file = null; rev++;
    await web.stop();
    pushPlans(); pushState(); sendSuite();
    return { ok: true, rev };
  }
  const r = eventFromObject(raw);
  if (!r.ok) return { ok: false, rev, error: r.error };
  const prevId = event?.id;
  const prevWeb = event?.settings.web;
  event = r.value;
  if (prevId !== event.id) { for (const k of Object.keys(changed)) delete changed[k]; file = event.demo ? null : file; }
  if (Array.isArray(changedSlots)) {
    const now = house.now();
    for (const id of changedSlots.slice(0, 200)) if (typeof id === "string" && event.slots.some(s => s.id === id)) changed[id] = now;
  }
  rev++;
  // Weboberfläche folgt der Einstellung der Veranstaltung
  const w = event.settings.web;
  if (prevId !== event.id || !prevWeb || prevWeb.on !== w.on || prevWeb.port !== w.port) await applyWeb();
  storage.autosave(event, file, e => { saveError = e; pushState(); });
  if (!event.consent.save && !event.demo && prevId !== event.id) await storage.forget();
  pushPlans(); pushState(); sendSuite();
  return { ok: true, rev };
}

/** Geöffnete Datei mit Weboberfläche „an“: erst aus lassen und in der Oberfläche fragen (nie ohne Frage einschalten). */
function webOffForAsk(ev: CrewEvent): CrewEvent {
  if (ev.settings.web.on && !FLAGS.webOn) { ev.settings.web.on = false; askWeb = true; }
  else askWeb = false;
  return ev;
}

async function applyWeb(): Promise<void> {
  if (!event || !event.settings.web.on) { if (web.on) await web.stop(); pushState(); return; }
  const port = event.settings.web.port;
  if (web.on && web.status().port === port) return;
  await web.start(port);
  pushState();
}

// ------------------------------------------------------------------ Suite-Netz

function suitePort(): number {
  const env = Number(process.env.CREWLINK_SUITE_PORT);
  if (env >= 1024 && env <= 65535) return env;
  // Testinstanzen (eigener Datenordner, Screenshots) nie im echten Netz der Suite
  return process.env.CREWLINK_DATA || FLAGS.shot ? TEST_PORT : SUITE_PORT;
}

async function startSuite(): Promise<void> {
  if (suite) return;
  suite = new SuiteNet({ port: suitePort(), app: "Crew Link", ver: VERSION, answerProbes: true });
  await suite.start();
  chat = new ChatNet(suite, () => { if (main && !main.isDestroyed()) main.webContents.send("chat"); pushState(); }, t("chat.defaultNick"), t("chat.defaultWhere"));
  if (suite.listening) chat.setOn(true);
  const watch = new LeadWatch(suite.peer, Date.now());
  leads = watch;
  // Oberfläche höchstens 1× je Sekunde wegen fremder Leitstände aktualisieren (im Sekundentakt unten)
  suite.on("crew", (m, from) => { if (watch.hear(m, from.address, Date.now())) leadsDirty = true; });
  sendHere();
  hereTimer = setInterval(sendHere, CREW_HERE_EVERY_MS);
  tickTimer = setInterval(sendSuite, 1000);
  pushState();
}

function stopSuite(): void {
  clearInterval(hereTimer); clearInterval(tickTimer);
  chat?.quit(); chat?.setOn(false);
  suite?.stop();
  suite = null; chat = null; leads = null;
  pushState();
}

function httpAddr(): string {
  const st = web.status();
  return st.on ? `${addresses()[0]}:${st.port}` : "";
}
function sendHere(): void {
  if (!suite?.listening) return;
  suite.send("crew", { ...crewHere(event, { ver: VERSION, http: httpAddr(), rev, now: house.now() }) });
}
function sendSuite(): void {
  if (!suite?.listening) return;
  suite.send("crew", crewTick(event, { now: house.now(), rev }));
}

// ------------------------------------------------------------------ Menü

function buildMenu(): void {
  const send = (cmd: string) => () => { if (main && !main.isDestroyed()) main.webContents.send("menu", cmd); };
  const tpl: MenuItemConstructorOptions[] = [
    // Programm-Menü mit eigenen Texten statt Electrons englischem `appMenu` (QA 43)
    ...(process.platform === "darwin" ? [{ label: app.name, submenu: [
      { role: "about" as const, label: t("menu.about") },
      { type: "separator" as const },
      { role: "services" as const, label: t("menu.services") },
      { type: "separator" as const },
      { role: "hide" as const, label: t("menu.hide") },
      { role: "hideOthers" as const, label: t("menu.hideOthers") },
      { role: "unhide" as const, label: t("menu.unhide") },
      { type: "separator" as const },
      { role: "quit" as const, label: t("menu.quit") },
    ] }] : []),
    { label: t("menu.file"), submenu: [
      { label: t("start.new"), accelerator: "CmdOrCtrl+N", click: send("new") },
      { label: t("menu.open"), accelerator: "CmdOrCtrl+O", click: send("open") },
      { label: t("menu.save"), accelerator: "CmdOrCtrl+S", click: send("save") },
      { label: t("menu.saveAs"), accelerator: "Shift+CmdOrCtrl+S", click: send("saveAs") },
      { type: "separator" },
      { label: t("menu.demo"), click: send("demo") },
      { label: t("menu.print"), accelerator: "CmdOrCtrl+P", click: send("print") },
      { type: "separator" },
      { label: t("menu.start"), click: send("start") },
      ...(process.platform === "darwin" ? [] : [{ type: "separator" as const }, { role: "quit" as const }]),
    ] },
    { role: "editMenu" },
    { label: t("menu.view"), submenu: [{ role: "togglefullscreen" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

// ------------------------------------------------------------------ Start

app.whenReady().then(async () => {
  // Keine Berechtigungen nötig (kein MIDI, keine Kamera in Phase 1)
  session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  storage = new Storage(app.getPath("userData"));
  runLock = new RunLock(app.getPath("userData"));
  if (!FLAGS.shot) await runLock.acquire();
  suiteIntro = await readSuiteIntro(app.getPath("appData"));
  launcher = await detectSuiteLauncher();
  const sysLang = app.getLocale().toLowerCase().startsWith("de") ? "de" : "en";
  await storage.init(sysLang);
  if (FLAGS.lang) storage.prefs.lang = FLAGS.lang;
  setLang(storage.prefs.lang);
  if (process.platform === "darwin" && ICON) app.dock?.setIcon(nativeImage.createFromPath(ICON));
  // Ort des Quellcodes im Programm (EPL-2.0 Abschnitt 3.2 b, Rechtsprüfung Nr. 13)
  app.setAboutPanelOptions({ applicationName: "Crew Link", applicationVersion: VERSION, copyright: "© 2026 Philipp Spruck / NEXTPHILM · Eclipse Public License 2.0", credits: `Source code / Quellcode: ${SOURCE_URL}`, website: SOURCE_URL });
  buildMenu();
  web = new WebServer({
    dir: path.join(__dirname, "..", "web"),
    plan: v => planOf(v),
    house: () => house.now(),
    tick: () => ({ rev, src: "system" }),
    changed: () => pushState(),
  });
  // Veranstaltung beim Start: Demo, sonst die zuletzt gesicherte (nur mit Zustimmung)
  if (FLAGS.demo || FLAGS.shot) {
    const demo = makeDemo(house.now(), storage.prefs.lang);
    if (FLAGS.webOn || FLAGS.shot) demo.settings.web.on = true;
    if (FLAGS.port >= 1024 && FLAGS.port <= 65535) demo.settings.web.port = FLAGS.port;
    await setEvent(demo, []);
  } else {
    const last = await storage.loadLast();
    // eigene, mit Zustimmung gesicherte Veranstaltung nach Neustart/Absturz: Weboberfläche wie gesichert, ohne Frage
    // (Konzept „sendet sofort wieder“). Gefragt wird nur bei Dateien, die von Hand geöffnet werden.
    if (last) { file = last.file; askWeb = false; await setEvent(last.ev, []); }
    if (event && FLAGS.webOn) { event.settings.web.on = true; await applyWeb(); }
  }
  if (storage.prefs.suiteNet) await startSuite();
  createMain();

  // Hausuhr: jede Sekunde mit der Systemuhr vergleichen; Sprung > 2 s → Frage an die Oberfläche
  let lastShown = "";
  setInterval(() => {
    // fremde Leitstände nach 15 s ohne „here“ vergessen
    if (leads?.expire(Date.now()) || leadsDirty) { leadsDirty = false; pushState(); }
    // öffentliche Seite bekommt nur den gezeigten Tag: beim Tageswechsel neuen Plan senden
    const shown = event ? (dayView(event, house.now()) as { day?: { id: string }; next?: { id: string } }) : null;
    const id = shown?.day?.id ?? shown?.next?.id ?? "";
    if (id !== lastShown) { if (lastShown) { rev++; pushPlans(); } lastShown = id; }
    const j = house.tick();
    if (j !== null) { jump = j; pushState(); }
    else if (jump !== null && house.pendingJump !== null) jump = house.pendingJump;
  }, 1000);
  powerMonitor.on("resume", () => { house.reanchor(); jump = null; pushState(); });

  if (FLAGS.shot) void runShots(FLAGS.shot, { main: () => main, openClock: f => openClock(f, { show: false, width: 1280, height: 720 }), event: () => event, port: () => web.status().port, setLang: l => { storage.prefs.lang = l; setLang(l); },
    demo: async l => { const d = makeDemo(house.now(), l); d.settings.web = { ...d.settings.web, on: true, port: event?.settings.web.port ?? d.settings.web.port }; await setEvent(d, []); },
    introAt: FLAGS.introAt, launcher: FLAGS.launcherSim === "installed" || FLAGS.launcherSim === "missing" ? FLAGS.launcherSim : null });
});

const fromMain = (e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => !!main && e.sender === main.webContents;
const fromAny = (e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => fromMain(e) || [...clocks.values()].some(w => !w.isDestroyed() && w.webContents === e.sender);

ipcMain.handle("state:get", e => (fromAny(e) ? state() : null));
// Wer entscheidet über die Startanimation (EINBAU.md §5): eigener Schalter vor suite.json; nur einmal je Start;
// nicht nach Absturz (running.lock), nicht mit --shot/--no-intro/--no-anim.
ipcMain.handle("intro:take", e => {
  if (!fromMain(e)) return { enabled: false, holdAt: null, reduced: null };
  const first = !introTaken;
  introTaken = true;
  const wanted = storage.prefs.intro ?? suiteIntro;
  const enabled = first && wanted && !FLAGS.noIntro && !FLAGS.shot && !runLock.crashed;
  return { enabled, holdAt: null, reduced: null };
});
ipcMain.handle("plan:get", e => (fromAny(e) ? planOf("clock") : null));
ipcMain.handle("event:set", (e, ev: unknown, ch: unknown) => (fromMain(e) ? setEvent(ev, ch) : { ok: false, rev, error: "denied" }));
ipcMain.handle("event:demo", async e => { if (fromMain(e)) { file = null; await setEvent(makeDemo(house.now(), storage.prefs.lang), []); } });
ipcMain.handle("clock:ping", e => { const r = house.now(); return fromAny(e) ? { r, s: house.now() } : null; });
ipcMain.on("clock:answer", (e, accept: unknown) => {
  if (!fromMain(e)) return;
  if (accept === true) house.accept(); else house.glide();
  jump = null; pushState();
});
ipcMain.on("clock:open", (e, floor: unknown) => { if (fromMain(e) && typeof floor === "string") openClock(floor); });
ipcMain.handle("suite:launcher", async e => { if (!fromMain(e)) return null; launcher ??= await detectSuiteLauncher(); return launcherForUi(launcher); });
// feste Adresse, nie aus der Oberfläche; kein Argument
ipcMain.on("suite:launcher-page", e => { if (fromMain(e)) void shell.openExternal(SUITE_PAGE).catch(() => { /* kein Browser */ }); });
ipcMain.on("web:askDone", e => { if (fromMain(e)) { askWeb = false; pushState(); } });
ipcMain.on("privacy:set", (e, on: unknown) => { if (fromMain(e)) { privacy = on === true; rev++; pushPlans(); pushState(); } });
ipcMain.on("netlink:open", e => { if (fromMain(e)) void shell.openExternal("netlink://check?from=crew").catch(() => { /* NET Link fehlt */ }); });
ipcMain.handle("web:set", async (e, on: unknown, port: unknown) => {
  if (!fromMain(e) || !event) return web.status();
  if (typeof port === "number" && Number.isInteger(port) && port >= 1024 && port <= 65535) event.settings.web.port = port;
  event.settings.web.on = on === true;
  askWeb = false;
  rev++;
  if (web.on && web.status().port !== event.settings.web.port) await web.stop();
  await applyWeb();
  storage.autosave(event, file, er => { saveError = er; pushState(); });
  pushState(); sendHere();
  return web.status();
});
ipcMain.handle("prefs:set", async (e, p: unknown) => {
  if (!fromMain(e) || !p || typeof p !== "object") return storage.prefs;
  const o = p as Partial<Prefs>;
  if (o.lang === "de" || o.lang === "en") { storage.prefs.lang = o.lang; setLang(o.lang); buildMenu(); }
  if (o.theme === "day" || o.theme === "night" || o.theme === "system") storage.prefs.theme = o.theme;
  if (typeof o.showOnStart === "boolean") storage.prefs.showOnStart = o.showOnStart;
  if (typeof o.hideLauncherHint === "boolean") storage.prefs.hideLauncherHint = o.hideLauncherHint;
  if (typeof o.intro === "boolean" || o.intro === null) storage.prefs.intro = o.intro;
  if (typeof o.suiteNet === "boolean" && o.suiteNet !== storage.prefs.suiteNet) {
    storage.prefs.suiteNet = o.suiteNet;
    if (o.suiteNet) await startSuite(); else stopSuite();
  }
  if (!FLAGS.shot) await storage.savePrefs().catch(() => { /* ohne Speicher weiter */ });
  for (const w of clocks.values()) if (!w.isDestroyed()) w.webContents.send("state", state());
  pushState();
  return storage.prefs;
});

// Dateien
ipcMain.handle("file:open", async e => {
  if (!fromMain(e) || !main) return { ok: false, error: "denied" };
  const r = await dialog.showOpenDialog(main, { title: t("menu.open"), properties: ["openFile"], filters: [{ name: "Crew Link", extensions: [FILE_EXT] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, error: "canceled" };
  const rd = await storage.read(r.filePaths[0]);
  if (!rd.ok) return { ok: false, error: rd.error };
  file = rd.event.consent.save ? r.filePaths[0] : null;
  await setEvent(webOffForAsk(rd.event), []);
  return { ok: true, file: r.filePaths[0], event };
});
ipcMain.handle("file:save", async (e, as: unknown) => {
  if (!fromMain(e) || !main || !event) return { ok: false, error: "denied" };
  if (event.demo) return { ok: false, error: "demo" };
  if (!event.consent.save) return { ok: false, error: "consent" };
  let target = file;
  if (as === true || !target) {
    const r = await dialog.showSaveDialog(main, { title: t("menu.saveAs"), defaultPath: `${(event.name || "Crew Link").replace(/[\\/:*?"<>|]+/g, " ").trim()}.${FILE_EXT}`, filters: [{ name: "Crew Link", extensions: [FILE_EXT] }] });
    if (r.canceled || !r.filePath) return { ok: false, error: "canceled" };
    target = r.filePath.endsWith(`.${FILE_EXT}`) ? r.filePath : `${r.filePath}.${FILE_EXT}`;
  }
  try { await storage.write(event, target); } catch (er) { saveError = String((er as NodeJS.ErrnoException).code ?? er); pushState(); return { ok: false, error: saveError }; }
  file = target; saveError = null; pushState();
  return { ok: true, file: target };
});
ipcMain.handle("template:save", async (e, tpl: unknown) => {
  if (!fromMain(e) || !main) return { ok: false, error: "denied" };
  const p = parseTemplate(JSON.stringify(tpl));
  if (!p.ok) return { ok: false, error: p.error };
  const r = await dialog.showSaveDialog(main, { title: t("tpl.save"), defaultPath: `${(p.value.name || t("tpl.defaultName")).replace(/[\\/:*?"<>|]+/g, " ").trim()}.${TEMPLATE_EXT}`, filters: [{ name: "Crew Link", extensions: [TEMPLATE_EXT] }] });
  if (r.canceled || !r.filePath) return { ok: false, error: "canceled" };
  try { await writeAtomic(r.filePath, JSON.stringify(p.value, null, 1)); } catch (er) { return { ok: false, error: String((er as NodeJS.ErrnoException).code ?? er) }; }
  return { ok: true, file: r.filePath };
});
ipcMain.handle("template:open", async e => {
  if (!fromMain(e) || !main) return { ok: false, error: "denied" };
  const r = await dialog.showOpenDialog(main, { title: t("tpl.open"), properties: ["openFile"], filters: [{ name: "Crew Link", extensions: [TEMPLATE_EXT] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, error: "canceled" };
  try {
    const p = parseTemplate(await fsp.readFile(r.filePaths[0], "utf8"));
    return p.ok ? { ok: true, template: p.value } : { ok: false, error: p.error };
  } catch { return { ok: false, error: "read" }; }
});

// Suite-Chat (wie VJ-Link)
let chatFlashing = false;
ipcMain.handle("chat:get", (e, since: unknown) => (fromMain(e) && chat ? chat.state(typeof since === "number" ? since : 0) : null));
ipcMain.handle("chat:post", (e, text: unknown, urgent: unknown) => (fromMain(e) && chat ? chat.post(text, urgent) : false));
ipcMain.handle("chat:profile", (e, nick: unknown, where: unknown) => (fromMain(e) && chat ? chat.profile(nick, where) : null));
ipcMain.on("chat:attention", e => {
  if (!fromMain(e) || !main || main.isDestroyed() || (main.isFocused() && !main.isMinimized())) return;
  if (process.platform === "darwin") app.dock?.bounce("critical");
  else if (!chatFlashing) { chatFlashing = true; main.flashFrame(true); const w = main; w.once("focus", () => { chatFlashing = false; if (!w.isDestroyed()) w.flashFrame(false); }); }
});

app.on("window-all-closed", () => { app.quit(); });
let byeSent = false;
app.on("will-quit", e => {
  if (byeSent) return;
  byeSent = true;
  e.preventDefault();
  void (async () => {
    try { await storage?.flush(); } catch { /* egal */ }
    stopSuite();
    await web?.stop().catch(() => { /* egal */ });
    runLock?.release();
    setTimeout(() => app.quit(), 150);
  })();
});
