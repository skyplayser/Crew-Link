// Leitstand-Oberfläche: Kopfzeile, Sperrstunden-Leiste, Tabs, Hinweis-Leiste, Startbildschirm mit Startanimation,
// Einstellungen. Aufbau wie design/muster-leitstand.html.
import { msToNextSecond } from "../core/clock";
import { dayView } from "../core/countdown";
import { getLang, setLang, t } from "../core/i18n";
import { planFor, recentNotices } from "../core/plan";
import { localHM, localHMS } from "../core/zeit";
import type { AppState, Prefs } from "../shared/bridge";
import { icon } from "../shared/icons";
import { noticeText } from "../shared/notices";
import { playProgramIntro, defaultImages } from "./intro/program-intro.js";
import { showLauncherHint } from "./suite/launcher-hint.js";
import { applyTheme, btn, dayLabel, el, iconSpan, seg, toast } from "../shared/ui";
import { ChatUi } from "./chat";
import { C, bridge, ev, now, startClockSync, type Tab } from "./ctx";
import { askConsent, clockJumpDialog, confirmBox, modal, newEventDialog, onCreated, templateDialog } from "./dialogs";
import { ShowLock } from "./lock";
import { openPrint, qrBox, webBase } from "./print";
import { curfewBar, leadWarning, renderClockTab, renderConnect, renderNow, renderRoles, renderSignals, setWeb, webError } from "./tabs";
import { renderTimetable, tickTimetable } from "./timetable";

const TABS: Tab[] = ["now", "timetable", "clock", "roles", "signals", "connect"];
const root = document.getElementById("app")!;
let started = false;
let startShown = true;
let lock: ShowLock;
let chat: ChatUi;
const hclock = el("div", "hclock");
const status = el("div", "status");
const tabsNav = el("nav", "tabs");
const curfewSlot = el("div");
const content = el("div", "tab-content");
const noticesBar = el("div", "notices");
let startEl: HTMLElement | null = null;

// ------------------------------------------------------------------ Aufbau

function shell(): void {
  const logo = el("div", "logo");
  const img = el("img"); img.src = "../assets/symbol.svg"; img.alt = "";
  logo.append(img, "Crew Link");
  tabsNav.setAttribute("role", "tablist");
  const lockBtn = el("button", "btn icon-btn lock-btn");
  lockBtn.type = "button"; lockBtn.id = "lock-btn";
  const gear = el("button", "btn icon-btn");
  gear.type = "button"; gear.append(icon("settings")); gear.setAttribute("aria-label", t("top.settings")); gear.title = t("top.settings");
  gear.setAttribute("data-allow", "");
  gear.addEventListener("click", settingsDialog);
  chat = new ChatUi(bridge);
  const top = el("header", "top", logo, tabsNav, status, el("span", "spacer"), hclock, chat.btn, lockBtn, gear);
  noticesBar.setAttribute("aria-label", t("notices.label"));
  const sh = el("div", "shell", top, curfewSlot, content, noticesBar);
  root.replaceChildren(sh);
  lock = new ShowLock(lockBtn, msg => toast(msg), on => { C.locked = on; renderTick(); });
  C.locked = lock.locked;
}

function renderTabs(): void {
  tabsNav.replaceChildren(...TABS.map(id => {
    const b = el("button", C.tab === id ? "on" : "", t(`tab.${id}`));
    b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(C.tab === id));
    b.addEventListener("click", () => { C.tab = id; render(); });
    return b;
  }));
}

function renderStatus(): void {
  const st = C.st!;
  const pill = (cls: string, text: string) => el("span", `pill ${cls}`, el("span", "dot"), text);
  status.replaceChildren(
    st.suite.listening ? pill("ok", t("top.net", { n: st.suite.peers })) : pill(st.suite.on && st.suite.error ? "err" : "", t("top.netOff")),
    st.web.on ? pill("ok", t("top.web", { n: st.web.clients })) : pill(st.web.error ? "err" : "", t("top.webOff")),
    (() => { const lw = leadWarning(); return lw ? pill("err", lw.short) : ""; })(),
  );
}

function render(): void {
  if (!C.st) return;
  document.documentElement.lang = getLang();
  renderTabs();
  renderStatus();
  const e = ev();
  if (!e) {
    content.replaceChildren(el("div", "web-off", t("start.noEvent"), el("span", "spacer"), btn("btn primary", t("start.new"), () => newEventDialog(), "newEvent")));
    (content.firstChild as HTMLElement).style.margin = "16px";
  } else if (C.tab === "timetable") renderTimetable(content);
  else if (C.tab === "now") renderNow(content);
  else if (C.tab === "clock") renderClockTab(content);
  else if (C.tab === "roles") renderRoles(content);
  else if (C.tab === "signals") renderSignals(content);
  else renderConnect(content);
  renderTick();
  if (startShown) { if (introRunning) startPending = true; else drawStart(); }
}
C.rerender = render;

/** Jede Sekunde (am Sekundenwechsel der Hausuhr): Uhr, Leiste, Countdowns. */
function renderTick(): void {
  if (!C.st) return;
  const e = ev();
  const n = now();
  hclock.replaceChildren(el("b", "num", e ? localHMS(n, e.tz) : new Date(n).toLocaleTimeString(getLang(), { hour12: false })), el("small", "", t("top.house", { src: t("start.time.system") })));
  curfewSlot.replaceChildren(curfewBar());
  noticesLine();
  if (!e) return;
  const active = document.activeElement;
  const typing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
  if (C.tab === "timetable") tickTimetable();
  else if (C.tab === "now" && !document.querySelector(".modal-back")) renderNow(content);
  else if (C.tab === "clock" && !typing) renderClockTab(content);
}

function noticesLine(): void {
  const e = ev();
  if (!e || !C.st) { noticesBar.hidden = true; return; }
  const n = now();
  const plan = planFor(e, "lead", { rev: C.st.rev, privacy: false, changed: C.st.changed });
  const list = recentNotices(plan, n);
  noticesBar.hidden = false;
  if (!list.length) { noticesBar.replaceChildren(el("span", "notice", t("notices.none"))); return; }
  noticesBar.replaceChildren(...list.map(x => {
    const [head, sub] = noticeText(x, plan, n);
    const cls = x.tone === "changed" ? "notice info" : "notice";
    const roles = x.roles.length >= 6 ? t("notices.all") : x.roles.map(r => t(`role.${r}`)).join(", ");
    return el("span", cls, el("time", "", localHM(x.at, e.tz)), x.kind === "changed" ? el("span", "t-info", t("tl.changed")) : x.kind === "over" ? el("span", "t-over", head) : head, x.kind !== "over" && sub ? ` · ${sub}` : "", ` → ${roles}`);
  }));
}

// ------------------------------------------------------------------ Startbildschirm

function hideStart(): void { introCtl?.finish(true); startShown = false; startEl?.remove(); startEl = null; }
function showStart(): void { startShown = true; drawStart(); }

function drawStart(): void {
  const st = C.st!;
  const e = ev();
  const s = el("div", "start");
  s.setAttribute("role", "dialog"); s.setAttribute("aria-label", t("start.aria"));
  const logo = el("div", "start-logo");
  logo.id = "start-logo";
  for (const [cls, f] of [["on-dark", "logo-horizontal-on-dark.svg"], ["on-light", "logo-horizontal-on-light.svg"]]) { const i = el("img", cls!); i.src = `../assets/${f}`; i.alt = "Crew Link"; logo.append(i); }
  const tile = (ico: string, title: string, sub: string, fn: () => void, primary = false) => {
    const b = el("button", `start-btn${primary ? " primary" : ""}`);
    b.type = "button"; b.append(icon(ico), el("span", "start-btxt", el("b", "", title), el("small", "", sub)));
    b.addEventListener("click", fn);
    return b;
  };
  const grid = el("div", "start-grid");
  if (e) {
    const v = dayView(e, now());
    let sub = e.name;
    if (v.mode === "running") sub = t("start.continue.sub", { name: e.name, n: v.index + 1, m: e.days.length, day: dayLabel(v.day.date), time: v.day.curfew !== null ? localHM(v.day.curfew, e.tz) : "—" });
    else if (v.mode === "between") sub = `${e.name} · ${t("days.next", { day: dayLabel(v.next.date), time: localHM(v.next.start, e.tz), t: "" }).replace(/ · .*$/, "")}`;
    grid.append(tile("play", t("start.continue"), sub, () => hideStart(), true));
  }
  grid.append(
    tile("newEvent", t("start.new"), t("start.new.sub"), () => newEventDialog(), !e),
    tile("template", t("start.template"), t("start.template.sub"), templateDialog),
    tile("open", t("start.open"), t("start.open.sub"), () => { void fileOpen(); }),
    tile("play", t("start.demo"), t("start.demo.sub"), () => { void bridge.demo().then(() => { C.dayId = null; C.slotId = null; hideStart(); C.tab = "now"; render(); }); }),
    tile("clock", t("start.clock"), t("start.clock.sub"), () => { if (e?.floors[0]) bridge.openClock(e.floors[0].id); else toast(t("start.noEvent"), true); }),
    tile("phone", t("start.phones"), t("start.phones.sub"), () => { if (!e) { toast(t("start.noEvent"), true); return; } hideStart(); C.tab = "roles"; void setWeb(true); render(); }),
    tile("net", t("start.suite"), t("start.suite.sub"), () => { hideStart(); C.tab = "connect"; render(); }),
  );
  const left = el("div", "start-left", logo, el("p", "start-tag", t("start.tag")), grid);
  // rechts: Weboberfläche, Suite, Zeitquelle, Sprache, Darstellung
  const sw = el("input", "switch");
  sw.type = "checkbox"; sw.checked = st.web.on; sw.disabled = !e; sw.setAttribute("aria-label", t("start.web.switch"));
  sw.addEventListener("change", () => { void setWeb(sw.checked); });
  const swl = el("label", "", t("start.web.switch"), " ", sw);
  swl.style.cssText = "display:flex;align-items:center;gap:8px;letter-spacing:0;text-transform:none;font-size:12px;color:var(--text);font-weight:600";
  const web = el("div", `start-web${st.web.on ? "" : " off"}`, qrBox(`${webBase()}/`), el("div", "", el("span", "hint", t("start.web.open")), el("span", "ipl", webBase().replace("http://", "")),
    el("span", "hint", st.web.on ? t("start.web.note") : t("start.web.off")),
    st.web.on ? el("span", "live ok", el("span", "dot"), t("start.web.count", { n: st.web.clients })) : st.web.error ? el("span", "live wait", webError(st.web.error, st.web.port, st.web.holder)) : ""));
  (web.lastChild as HTMLElement).style.cssText = "display:grid;gap:4px";
  const peers = el("div", "start-net", el("h3", "", t("start.suite.title")));
  const lw = leadWarning();
  if (lw) { const w = el("div", "note warn", lw.long); w.setAttribute("role", "alert"); peers.append(w); }
  if (!st.suite.listening) peers.append(el("div", "live off", el("span", "dot"), el("span", "", st.suite.on ? t("start.suite.error") : t("top.netOff"))));
  else peers.append(el("div", "live ok", el("span", "dot"), el("span", "", t("start.suite.on")), el("small", "", t("start.suite.peers", { n: st.suite.peers }))));
  const time = el("div", "start-net", el("h3", "", t("start.time")),
    el("div", "live ok", el("span", "dot"), el("span", "", t("start.time.system")), (() => { const x = el("small", "", t("start.time.house", { time: e ? localHMS(now(), e.tz) : "" })); x.id = "start-house"; return x; })()),
    el("div", "live off", el("span", "dot"), el("span", "", t("start.time.tc")), el("small", "", t("phase", { n: 4 }))));
  const extra = el("div", "start-extra",
    el("div", "start-lang", iconSpan("globe"), el("span", "", t("start.lang")), seg<"de" | "en">([["de", "Deutsch"], ["en", "English"]], st.prefs.lang, l => { void setPrefs({ lang: l }); })),
    el("div", "start-lang", iconSpan(document.documentElement.dataset.theme === "day" ? "sun" : "moon"), el("span", "", t("start.theme")),
      seg<Prefs["theme"]>([["day", t("theme.day")], ["night", t("theme.night")], ["system", t("theme.system")]], st.prefs.theme, th => { void setPrefs({ theme: th }); })));
  const hintSlot = el("div", "lsh-slot");
  const right = el("div", "start-right", el("div", "start-net", el("h3", "", el("span", "", t("start.web")), el("span", "spacer"), swl), web), peers, time, extra, hintSlot);
  placeLauncherHint(hintSlot);
  const show = el("input", "check");
  show.type = "checkbox"; show.checked = st.prefs.showOnStart;
  show.addEventListener("change", () => { void setPrefs({ showOnStart: show.checked }); });
  const foot = el("div", "start-foot", el("label", "start-check", show, " ", t("start.showOnStart")), el("span", "start-foot-r", `Crew Link ${st.version} · EPL-2.0`));
  s.append(el("div", "start-card", left, right), foot);
  if (startEl) startEl.replaceWith(s); else document.body.insertBefore(s, document.getElementById("lsi"));
  startEl = s;
}

// ------------------------------------------------------------------ Karte „Link-Suite laden“ (Baustein der Suite)

/** Endet die Startanimation (auch wenn keine läuft: der Baustein meldet sich dann sofort mit shown:false). */
const introDone = new Promise<void>(r => addEventListener("linksuite-intro-done", () => r(), { once: true }));
let launcherInfo: { installed: boolean; version?: string } | null = null;
let hint: ReturnType<typeof showLauncherHint> | null = null;
let hintMade = false;

/** Darf die Karte stehen? Nicht in Demo/Screenshots (außer --hint), nicht während eine Nacht läuft (Show). */
function hintAllowed(): boolean {
  const st = C.st!;
  const e = ev();
  if (st.flags.hint) return true;
  if (st.flags.shot || e?.demo) return false;
  return !(e && dayView(e, now()).mode === "running");
}

/**
 * Am Ende der rechten Spalte, kompakt, nicht in revealTargets; blendet erst nach linksuite-intro-done ein. Die Karte
 * wird einmal gebaut und bei jedem Neuaufbau des Startbildschirms nur umgehängt (kein zweites Einblenden).
 */
function placeLauncherHint(slot: HTMLElement): void {
  const st = C.st!;
  if (!hintAllowed() || st.prefs.hideLauncherHint) { hint?.remove(); return; }
  if (hint?.el) { slot.append(hint.el); return; }
  if (hintMade) return;
  hintMade = true;
  hint = showLauncherHint({
    host: slot, launcher: launcherInfo, iconSrc: "suite/icons/link-suite-icon.svg", lang: getLang(), compact: true,
    hidden: st.prefs.hideLauncherHint, allowed: true, after: introDone,
    onGet: () => bridge.openLauncherPage(),
    onHide: () => { void bridge.setPrefs({ hideLauncherHint: true }).then(p => { if (C.st) C.st.prefs = p; }); },
  });
}

// ------------------------------------------------------------------ Startanimation („Programm-Intro“ der Suite)

/** Läuft die Startanimation? Dann den Startbildschirm nicht neu bauen (EINBAU.md §4), sondern puffern. */
let introRunning = false;
let startPending = false;
let introCtl: { finish(skipped: boolean): void } | null = null;

const raf2 = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
const introTheme = (): "dark" | "light" => (document.documentElement.dataset.theme === "day" ? "light" : "dark");

/** Schicht #lsi (im HTML als letztes Element; für Standbilder neu anlegen). */
function introLayer(): HTMLElement {
  let l = document.getElementById("lsi");
  if (!l) { l = el("div", "lsi-layer", el("div", "lsi-bg")); l.id = "lsi"; document.body.append(l); }
  return l;
}

/**
 * Programm-Intro aufrufen – erst nach fertigem Startbildschirm, Schriften und erstem Layout. Ob es läuft, entscheidet
 * der Hauptprozess (eigener Schalter vor suite.json, einmal je Programmstart, nicht nach Absturz, nicht mit --shot).
 * Ziel: das ganze SVG-Logo im Startbildschirm (#start-logo, img.on-dark/.on-light). Ist der Startbildschirm aus: das
 * Zeichen im Kopf (HTML-Logo: Zeichen + Text).
 */
function playIntro(o: { enabled: boolean; holdAt?: number | null; reduced?: boolean | null }): void {
  const layer = introLayer();
  const theme = introTheme();
  const onStart = startShown && !!startEl;
  introRunning = o.enabled;
  introCtl = playProgramIntro({
    layer, app: "cr",
    logoTarget: () => (onStart ? document.getElementById("start-logo") : document.querySelector(".top .logo")),
    ...(onStart ? {} : { signTarget: () => document.querySelector(".top .logo img") }),
    targetKind: "logo",
    revealTargets: () => (onStart ? Array.from(document.querySelectorAll(".start-tag, .start-grid .start-btn, .start-right > :not(.lsh-slot), .start-foot")) : []),
    images: defaultImages("intro/icons/", theme, "cr"),
    theme,
    enabled: o.enabled,
    ...(o.reduced !== undefined && o.reduced !== null ? { reduced: o.reduced } : {}),
    ...(o.holdAt !== undefined && o.holdAt !== null ? { holdAt: o.holdAt } : {}),
    text: k => t(`intro.${k}`),
  });
}

addEventListener("linksuite-intro-done", () => {
  introRunning = false;
  introCtl = null;
  if (startPending) { startPending = false; if (startShown) drawStart(); }
  // Fokus auf „Weiter“ erst jetzt
  (document.querySelector(".start-btn.primary") as HTMLElement | null)?.focus();
});

async function startIntro(): Promise<void> {
  const r = await bridge.introTake().catch(() => ({ enabled: false, holdAt: null, reduced: null }));
  if (!r.enabled) { playIntro({ enabled: false }); return; }
  await document.fonts.ready;
  await raf2();
  playIntro({ enabled: true, holdAt: r.holdAt, reduced: r.reduced });
}

// ------------------------------------------------------------------ Einstellungen, Dateien

async function setPrefs(p: Partial<Prefs>): Promise<void> {
  const r = await bridge.setPrefs(p);
  if (p.lang) { setLang(r.lang); hint?.remove(); hint = null; hintMade = false; } // Karte in der neuen Sprache neu bauen
  if (p.theme) applyTheme(r.theme);
  C.st = { ...C.st!, prefs: r };
  shellTexts();
  render();
}

function shellTexts(): void {
  noticesBar.setAttribute("aria-label", t("notices.label"));
}

function settingsDialog(): void {
  const st = C.st!;
  const m = modal(t("set.title"));
  m.back.classList.add("allow-locked");
  const row = (label: string, sub: string, ctl: HTMLElement) => el("div", "set-row", el("span", "set-label", el("b", "", label), el("small", "", sub)), ctl);
  const sw = (on: boolean, fn: (v: boolean) => void) => { const i = el("input", "switch"); i.type = "checkbox"; i.checked = on; i.addEventListener("change", () => fn(i.checked)); return i; };
  m.body.append(
    row(t("start.lang"), "", seg<"de" | "en">([["de", "Deutsch"], ["en", "English"]], st.prefs.lang, l => { m.close(); void setPrefs({ lang: l }).then(settingsDialog); })),
    row(t("start.theme"), "", seg<Prefs["theme"]>([["day", t("theme.day")], ["night", t("theme.night")], ["system", t("theme.system")]], st.prefs.theme, th => { m.close(); void setPrefs({ theme: th }).then(settingsDialog); })),
    row(t("set.intro"), t("set.intro.sub", { suite: st.suiteIntro ? t("set.intro.on") : t("set.intro.off") }),
      seg<"suite" | "on" | "off">([["suite", t("set.intro.suite")], ["on", t("set.intro.on")], ["off", t("set.intro.off")]], st.prefs.intro === null ? "suite" : st.prefs.intro ? "on" : "off",
        v => { m.close(); void setPrefs({ intro: v === "suite" ? null : v === "on" }).then(settingsDialog); })),
    row(t("start.showOnStart"), "", sw(st.prefs.showOnStart, v => { void setPrefs({ showOnStart: v }); })),
    row(t("privacy.title"), t("privacy.sub"), sw(st.privacy, v => bridge.setPrivacy(v))),
    row(t("set.save"), ev()?.demo ? t("demo.noSave") : ev()?.consent.save ? (st.file ?? t("set.save.auto")) : t("set.save.off"), btn("btn small", t("set.change"), async () => {
      const e = ev(); if (!e || e.demo) return;
      const r = await askConsent("save", e.consent.save);
      if (r !== null) { m.close(); await bridge.setEvent({ ...e, consent: { ...e.consent, save: r, at: now() } }); }
    })),
    el("div", "", btn("btn", t("menu.start"), () => { m.close(); showStart(); }, "play")),
  );
  if (st.saveError) m.body.append(el("div", "note warn", t("save.error", { e: st.saveError })));
  m.foot.append(el("span", "muted small", `Crew Link ${st.version} · EPL-2.0`), btn("btn primary", t("dlg.close"), () => m.close()));
}

async function fileOpen(): Promise<void> {
  const r = await bridge.fileOpen();
  if (r.ok) { C.dayId = null; C.slotId = null; hideStart(); C.tab = "timetable"; render(); toast(t("file.opened")); }
  else if (r.error !== "canceled") toast(t("err.file", { e: t(`err.code.${r.error}`) }), true);
}

async function fileSave(as: boolean): Promise<void> {
  const e = ev();
  if (!e) return;
  if (e.demo) { toast(t("demo.noSave"), true); return; }
  if (!e.consent.save) {
    const ok = await askConsent("save", false);
    if (!ok) return;
    await bridge.setEvent({ ...e, consent: { ...e.consent, save: true, at: now() } });
  }
  const r = await bridge.fileSave(as);
  if (r.ok) toast(t("file.saved", { f: r.file ?? "" }));
  else if (r.error !== "canceled") toast(t("err.file", { e: r.error }), true);
}

function menu(cmd: string): void {
  if (cmd === "new") newEventDialog();
  else if (cmd === "open") void fileOpen();
  else if (cmd === "save") void fileSave(false);
  else if (cmd === "saveAs") void fileSave(true);
  else if (cmd === "demo") void bridge.demo().then(() => { C.dayId = null; hideStart(); render(); });
  else if (cmd === "print") openPrint("day");
  else if (cmd === "start") showStart();
}

// ------------------------------------------------------------------ Start

function onState(s: AppState): void {
  const prevEvent = C.st?.event?.id;
  C.st = s;
  if (s.event?.id !== prevEvent) { C.dayId = null; C.slotId = null; }
  if (C.slotId && !s.event?.slots.some(x => x.id === C.slotId)) C.slotId = null;
  if (s.clockJump !== null) clockJumpDialog(s.clockJump);
  if (s.askWeb) askWebOnce();
  if (!started) return;
  // nicht neu zeichnen, während getippt wird (Fokus bliebe sonst nicht stehen)
  const a = document.activeElement;
  if ((a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement) && content.contains(a) && a.type !== "checkbox") {
    renderStatus(); return;
  }
  if (!C.dragging) render();
}

let asking = false;
/** Geöffnete Veranstaltung hatte die Weboberfläche an: fragen statt still einschalten. */
function askWebOnce(): void {
  if (asking) return;
  asking = true;
  void confirmBox(t("web.ask.title"), t("web.ask.text"), t("web.ask.yes")).then(yes => {
    asking = false;
    if (yes) void setWeb(true); else bridge.webAskDone();
  });
}

function loop(): void {
  renderTick();
  if (startShown && startEl && C.st) {
    // Startbildschirm: nur die Uhrzeit der Zeitquelle aktualisieren
    const small = document.getElementById("start-house");
    const e = ev();
    if (small && e) small.textContent = t("start.time.house", { time: localHMS(now(), e.tz) });
  }
  setTimeout(loop, msToNextSecond(now()));
}

async function boot(): Promise<void> {
  const s = await bridge.getState();
  C.st = s;
  setLang(s.prefs.lang);
  applyTheme(s.prefs.theme);
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (C.st?.prefs.theme === "system") applyTheme("system"); });
  launcherInfo = await bridge.suiteLauncher().catch(() => null);
  bridge.onSuiteLauncher(l => { launcherInfo = l; hint?.update(l); });
  shell();
  bridge.onState(onState);
  bridge.onMenu(menu);
  onCreated(() => { C.dayId = null; C.slotId = null; hideStart(); C.tab = "timetable"; render(); toast(t("new.created")); });
  // Laufender Tag im JETZT, sonst TIMETABLE
  if (s.event) { const v = dayView(s.event, Date.now()); C.tab = v.mode === "running" ? "now" : "timetable"; }
  startShown = s.prefs.showOnStart || !s.event;
  started = true;
  render();
  void startIntro();
  void startClockSync();
  loop();
  if (s.flags.shot) installShotApi();
}

/** Für die QA (--shot): der Hauptprozess steuert die Oberfläche über diese Funktionen. */
function installShotApi(): void {
  (window as unknown as { crewShot: unknown }).crewShot = {
    start: (show: boolean) => { if (show) showStart(); else hideStart(); },
    tab: (id: Tab) => { C.tab = id; hideStart(); render(); },
    theme: (th: "day" | "night") => { void setPrefs({ theme: th }); },
    lang: (l: "de" | "en") => { void setPrefs({ lang: l }); },
    select: (name: string) => { const e = ev(); const s = e?.slots.find(x => x.name === name); C.slotId = s?.id ?? null; render(); },
    /** Standbild der Startanimation bei `ms` (Baustein-Option holdAt), Startbildschirm darunter */
    intro: async (ms: number, reduced: boolean, head = false) => {
      introCtl?.finish(false);
      document.getElementById("lsi")?.remove();
      if (head) hideStart(); else showStart();
      await document.fonts.ready; await raf2();
      playIntro({ enabled: true, holdAt: ms, reduced });
    },
    introEnd: () => { introCtl?.finish(false); },
  };
}

void boot();
