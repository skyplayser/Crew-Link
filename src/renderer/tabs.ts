// Tabs JETZT, UHR, ROLLEN, SIGNALE (Platzhalter Phase 4), VERBINDEN und die Sperrstunden-Leiste.
import { curfewPhase, curfewSequence, dayView, floorStatus, fmtCountdown, type FloorStatus } from "../core/countdown";
import { t } from "../core/i18n";
import { newPin, PIN_ROLES, ROLES, type ChatMode, type CrewEvent, type Role } from "../core/model";
import { localHM, MIN } from "../core/zeit";
import { btn, cd, dayLabel, el, floorVar, iconSpan, inOrPast, input, seg, sq, toast } from "../shared/ui";
import { C, bridge, edit, ev, now } from "./ctx";
import { askConsent } from "./dialogs";
import { openPrint, qrBox, rolePath, webBase } from "./print";
import { extend, handoverNow, shiftAll, shorten } from "./timetable";

/** Eine Sammel-Warnung für fremde Leitstände (statt einer Pille je Paket). */
export function leadWarning(): { short: string; long: string } | null {
  const list = C.st?.otherLeads ?? [];
  if (!list.length) return null;
  const addr = (o: { http: string; address: string }) => o.http || o.address;
  if (list.length === 1) { const o = list[0]!; return { short: t("top.twoLeads", { addr: addr(o) }), long: t(o.weFirst ? "lead.first" : "lead.second", { addr: addr(o) }) }; }
  return { short: t("top.manyLeads", { n: list.length }), long: t("lead.many", { n: list.length, list: list.slice(0, 3).map(addr).join(", ") }) };
}

// ------------------------------------------------------------------ Sperrstunden-Leiste

export function curfewBar(): HTMLElement {
  const bar = el("div", "curfew-bar");
  bar.id = "curfew-bar";
  const e = ev();
  if (!e) return bar;
  const n = now();
  const v = dayView(e, n);
  if (v.mode === "between") {
    bar.append(el("div", "curfew-main", el("span", "cd-word", t("cd.nextDay")), el("span", "cd idle", `${dayLabel(v.next.date)} ${localHM(v.next.start, e.tz)} · ${t("cd.in", { t: fmtCountdown(v.inMs) })}`)));
  } else if (v.mode === "running") {
    const d = v.day;
    const day = dayLabel(d.date).split(" ")[0]!;
    if (d.curfew !== null) {
      const ph = curfewPhase(d.curfew, n, e.signals);
      if (ph === "warn") bar.classList.add("warn");
      if (ph === "last" || ph === "over") bar.classList.add("crit");
      const c = el("span", `cd${ph === "warn" ? " warn" : ph === "last" || ph === "over" ? " crit" : ""}`, ph === "over" ? t("cd.curfewNow") : t("cd.left", { t: fmtCountdown(d.curfew - n) }));
      if (ph === "normal") c.style.color = "var(--strong)";
      bar.append(el("div", "curfew-main", el("span", "cd-word", `${day} · `, t("curfew.label", { time: "" }), el("b", "", localHM(d.curfew, e.tz))), c));
      for (const p of curfewSequence(e, d)) {
        if (p.kind === "entryStop") bar.append(el("span", "pill plain", t("curfew.entry"), " ", el("b", "", localHM(p.at, e.tz)), ` · ${inOrPast(p.at, n)}`));
        if (p.kind === "lastRound") bar.append(el("span", "pill plain", t("curfew.lastRound"), " ", el("b", "", localHM(p.at, e.tz)), ` · ${inOrPast(p.at, n)}`));
        if (p.kind === "floor-end") bar.append(el("span", "pill plain", e.floors.find(f => f.id === p.floor)?.name ?? "", " ", el("b", "", localHM(p.at, e.tz)), ` · ${inOrPast(p.at, n)}`));
      }
    } else {
      bar.append(el("div", "curfew-main", el("span", "cd-word", `${day} · `, t("curfew.none")), el("span", "cd", t("cd.left", { t: fmtCountdown(d.end - n) }))));
    }
  } else if (v.mode === "after") bar.append(el("div", "curfew-main", el("span", "cd-word", t("curfew.after"))));
  else bar.append(el("div", "curfew-main", el("span", "cd-word", t("days.none"))));
  bar.append(el("span", "spacer"));
  const lw = leadWarning();
  if (lw) bar.append(el("span", "pill err", lw.long));
  if (C.st?.privacy) bar.append(el("span", "pill info", t("privacy.on")));
  if (C.locked) bar.append(el("span", "pill warn", t("lock.pill")));
  if (e.demo) bar.append(el("span", "pill info", t("demo.pill")));
  else if (!e.consent.save) bar.append(el("span", "pill warn", t("save.off.pill")));
  return bar;
}

// ------------------------------------------------------------------ JETZT

export function renderNow(root: HTMLElement): void {
  const e = ev();
  if (!e) return;
  const n = now();
  const v = dayView(e, n);
  const grid = el("div", "now-grid");
  grid.id = "now-grid";
  if (v.mode !== "running") {
    const c = el("section", "now-floor closed");
    c.style.setProperty("--c", "var(--line)");
    if (v.mode === "between") {
      c.append(el("div", "head", el("b", "", t("cd.nextDay")), el("span", "pill", `${dayLabel(v.next.date)} ${localHM(v.next.start, e.tz)}`)),
        el("span", "cd-word", v.next.label || dayLabel(v.next.date)), el("span", "cd idle", fmtCountdown(v.inMs)),
        el("span", "after", t("days.next", { day: dayLabel(v.next.date), time: localHM(v.next.start, e.tz), t: fmtCountdown(v.inMs) })));
    } else c.append(el("div", "head", el("b", "", t(v.mode === "after" ? "curfew.after" : "days.none"))));
    grid.append(c);
  } else {
    e.floors.forEach((f, i) => grid.append(nowCard(e, f.id, f.name, f.color, i, floorStatus(e, v.day, f.id, n))));
  }
  root.replaceChildren(grid);
}

function nowCard(e: CrewEvent, floorId: string, name: string, color: number, i: number, st: FloorStatus): HTMLElement {
  const card = el("section", "now-floor");
  card.style.setProperty("--c", floorVar(color));
  const tag = st.state === "over" ? el("span", "tag err", t("cd.overWord")) : st.state === "ended" || st.state === "closed" ? el("span", "tag dim", t(st.state === "closed" ? "tl.closed" : "now.ended")) : el("span", "pill", t("now.floorN", { n: i + 1 }));
  card.append(el("div", "head", el("b", "", sq(color), name), tag));
  const tz = e.tz;
  if ((st.state === "live" || st.state === "over") && st.cur) {
    if (st.state === "over") card.classList.add("over");
    card.append(el("span", "cd-word", st.state === "over" ? t("cd.overWord") : t("cd.setEnd"), " · ", el("b", "", st.cur.name), st.state === "over" ? ` · ${t("clock.planned", { time: localHM(st.cur.end, tz) })}` : ""), cd(st.remaining!));
    const after = el("span", "after");
    if (st.next) {
      after.append(t("clock.after"), " ", el("b", "", st.next.name), ` ${localHM(st.next.start, tz)}–${localHM(st.next.end, tz)}`);
      if (st.next.public && st.next.public !== st.next.name) after.append(` (${t("tl.public", { name: st.next.public })})`);
      if (st.next.readyAt !== undefined) { const r = el("span", "", " · ", t("clock.ready")); r.style.cssText = "color:var(--ok);font-weight:700"; after.append(r); }
      else if (st.state === "over") after.append(" · ", t("now.notReady"));
      if (st.state === "live" && !st.nextOn) after.append(" · ", t("clock.handoverFrom", { time: localHM(st.cur.end - e.signals.nextDjMin * MIN, tz) }));
    } else after.append(st.ownEnd ? t("clock.floorEndAt", { time: localHM(st.floorEnd, tz) }) : t("now.last"));
    card.append(after);
    const confirm = e.settings.handover === "confirm" && !!st.next;
    const actions = el("div", "actions");
    if (st.state === "over") {
      actions.append(btn("btn", t("slot.keepGoing"), () => toast(t("slot.keepGoing.done"))));
      if (st.next) actions.append(btn("btn", t("slot.shortenNext"), () => { void shorten(st.cur!.id); }));
      actions.append(btn("btn", t("slot.shiftAll"), () => { void shiftAll(st.cur!.id); }));
      if (confirm) actions.append(btn("btn primary", t("slot.handover"), () => { void handoverNow(floorId); }));
    } else {
      actions.append(btn("btn", t("slot.extend"), () => { void extend(st.cur!.id); }));
      if (confirm) actions.append(btn("btn", t("slot.handover"), () => { void handoverNow(floorId); }));
    }
    card.append(actions);
  } else if ((st.state === "before" || st.state === "gap") && st.next) {
    card.append(el("span", "cd-word", st.next.kind === "changeover" ? t("slot.kind.changeover") : t("cd.next"), " · ", el("b", "", st.next.name)));
    card.append(el("span", `cd ${st.nextOn ? "next-on" : "next"}`, fmtCountdown(st.nextIn!)));
    card.append(el("span", "after", `${localHM(st.next.start, tz)}–${localHM(st.next.end, tz)}`));
  } else {
    card.classList.add("closed");
    card.append(el("span", "cd-word", st.ownEnd ? t("cd.floorEnd") : t("cd.curfew"), " · ", localHM(st.floorEnd, tz)), el("span", "cd idle", t("cd.past")));
    const nd = nextDayFirst(e, floorId);
    if (nd) card.append(el("span", "after", nd));
  }
  return card;
}

function nextDayFirst(e: CrewEvent, floorId: string): string {
  const n = now();
  const day = e.days.find(d => d.start > n);
  if (!day) return "";
  const s = e.slots.filter(x => x.day === day.id && x.floor === floorId).sort((a, b) => a.start - b.start)[0];
  return s ? t("now.nextDayFirst", { day: day.label || dayLabel(day.date), time: localHM(s.start, e.tz) }) : "";
}

// ------------------------------------------------------------------ UHR

let clockSel: string | null = null;
export function renderClockTab(root: HTMLElement): void {
  const e = ev();
  if (!e) return;
  if (!clockSel || !e.floors.some(f => f.id === clockSel)) clockSel = e.floors[0]?.id ?? null;
  const n = now();
  const v = dayView(e, n);
  const list = el("div", "conn-list");
  e.floors.forEach((f, i) => {
    const st = v.mode === "running" ? floorStatus(e, v.day, f.id, n) : null;
    const status = st ? (st.state === "live" || st.state === "over" ? fmtCountdown(st.remaining!) : t(st.state === "closed" ? "tl.closed" : st.state === "ended" ? "now.ended" : "cd.next")) : "—";
    const s = st?.state === "over" ? "err" : st?.state === "live" ? "live" : "";
    const head = el("div", "conn-head", sq(f.color), el("span", "conn-name", el("b", "", f.name), el("small", "", `${t("now.floorN", { n: i + 1 })} · /uhr/${f.id}`)), (() => { const x = el("span", "conn-st", status); if (s) x.dataset.s = s; return x; })());
    head.addEventListener("click", () => { clockSel = f.id; C.rerender(); });
    head.setAttribute("data-allow", "");
    list.append(el("div", `conn${clockSel === f.id ? " sel" : ""}`, head));
  });
  const f = e.floors.find(x => x.id === clockSel);
  const det = el("div", "conn-detail");
  if (f) {
    const url = `${webBase()}/uhr/${f.id}`;
    const open = btn("btn primary big", t("clock.open"), () => bridge.openClock(f.id), "clock");
    open.setAttribute("data-allow", "");
    det.append(el("h3", "", sq(f.color), " ", f.name), el("p", "hint", t("clock.open.hint")), open,
      el("h2", "label", t("clock.browser")),
      C.st?.web.on ? el("div", "role-qr", qrBox(url), el("div", "", el("span", "url mono", url), el("p", "hint", t("clock.browser.hint")))) : el("div", "web-off", t("start.web.off")),
      el("h2", "label", t("clock.own")), el("p", "hint", t("clock.own.later")));
  }
  root.replaceChildren(el("div", "conn-split", list, det));
}

// ------------------------------------------------------------------ ROLLEN

const shownPins = new Set<string>();
export function renderRoles(root: HTMLElement): void {
  const e = ev();
  if (!e) return;
  const st = C.st!;
  const sw = el("input", "switch");
  sw.type = "checkbox"; sw.checked = st.web.on;
  sw.setAttribute("aria-label", t("start.web.switch"));
  sw.addEventListener("change", () => { void setWeb(sw.checked); });
  const head = el("div", "", el("label", "", sw, " ", t("roles.web")), el("span", "ipl", webBase()), el("span", "muted small", t("roles.unencrypted")), el("span", "spacer"),
    btn("btn", t("roles.printQr"), () => openPrint("qr"), "print"), btn("btn", t("roles.printLead"), () => openPrint("lead"), "print"));
  head.style.cssText = "display:flex;align-items:center;gap:12px;flex-wrap:wrap";
  (head.firstChild as HTMLElement).style.cssText = "display:flex;align-items:center;gap:8px;font-weight:600";
  const wrap = el("div", "", head);
  wrap.style.cssText = "padding:14px 16px 18px;display:grid;gap:12px";
  if (st.web.error) wrap.append(el("div", "note warn", webError(st.web.error, st.web.port, st.web.holder)));
  if (!st.web.on) {
    wrap.append(el("div", "web-off", iconSpan("phone"), el("span", "", t("roles.webOff")), el("span", "spacer"), btn("btn primary", t("start.phones"), () => { void setWeb(true); })));
  } else {
    const grid = el("div", "roles");
    const base = webBase();
    for (const r of ROLES) grid.append(roleCard(e, r, base));
    grid.append(el("div", "role-card", el("div", "head", iconSpan("public"), el("b", "", t("role.public")), el("span", "spacer"), el("span", "tag ok", t("roles.noPin"))),
      el("div", "role-qr", qrBox(base + "/oeffentlich"), el("div", "", el("span", "url", "/oeffentlich"), el("span", "hint", t("role.public.sub")), el("span", "hint", t("roles.devices", { n: st.web.byViewer.public ?? 0 }))))));
    grid.append(chatCard(e));
    wrap.append(el("p", "hint", t("roles.readonly")), grid);
  }
  // Protokoll der Nacht (Zustimmung schon im Modell; Funktion Phase 3)
  wrap.append(el("div", "note", el("b", "", t("log.title")), " · ", e.consent.log ? t("log.on") : t("log.off"), " ",
    btn("linkish", t("log.change"), async () => { const r = await askConsent("log", e.consent.log); if (r !== null) void edit(x => { x.consent = { ...x.consent, log: r, at: now() }; }); })));
  root.replaceChildren(wrap);
}

function pinTag(r: Role): HTMLElement {
  if (r === "security") return el("span", "tag dim", t("roles.pinEmergency"));
  return PIN_ROLES.includes(r) ? el("span", "tag dim", t("roles.pin")) : el("span", "tag ok", t("roles.noPin"));
}

function pinView(key: string, pin: string | undefined): HTMLElement {
  if (!pin) return el("span");
  const shown = shownPins.has(key);
  return el("span", "pin", el("code", "", shown ? `${pin.slice(0, 3)} ${pin.slice(3)}` : "••••••"),
    btn("linkish", shown ? t("roles.pinHide") : t("roles.pinShow"), () => { if (shown) shownPins.delete(key); else shownPins.add(key); C.rerender(); }));
}

function roleCard(e: CrewEvent, r: Role, base: string): HTMLElement {
  const n = C.st?.web.byViewer[r] ?? 0;
  const modes: [ChatMode, string][] = [["never", t("roles.chat.never")], ["notices", t("roles.chat.notices")], ["read", t("roles.chat.read")], ["write", t("roles.chat.write")]];
  const sub = r === "booth" ? t("roles.perFloor", { path: "/r/booth/<floor>" }) : r === "dj" ? t("roles.perDj", { path: "/r/dj/<name>" }) : "";
  return el("div", "role-card",
    el("div", "head", iconSpan(r === "lead" ? "lead" : r), el("b", "", t(`role.${r}`)), el("span", "spacer"), pinTag(r)),
    el("div", "role-qr", qrBox(base + rolePath(r)), el("div", "", el("span", "url", rolePath(r)), pinView(r, e.roles.pins[r]), sub ? el("span", "hint", sub) : "", el("span", "hint", t("roles.devices", { n })))),
    el("div", "field", el("span", "", t("roles.chat")), seg(modes, e.roles.chat[r], m => { void edit(x => { x.roles.chat[r] = m; }); })),
  );
}

function chatCard(e: CrewEvent): HTMLElement {
  return el("div", "role-card",
    el("div", "head", iconSpan("chat"), el("b", "", t("role.chat")), el("span", "spacer"), el("span", "tag dim", t("phase", { n: 2 }))),
    el("div", "role-qr", el("div", "", el("span", "url", "/chat"), pinView("chat", e.roles.chatPin), el("span", "hint", t("role.chat.sub")))),
    el("div", "", btn("btn small danger", t("roles.pinNew"), () => { void edit(x => { x.roles.chatPin = newPin(); }); })),
  );
}

export function webError(code: string, port: number, holder?: string): string {
  if (code === "EADDRINUSE") return holder ? t("web.err.inuseBy", { port, app: holder }) : t("web.err.inuse", { port });
  if (code === "EACCES") return t("web.err.access", { port });
  return t("web.err.other", { e: code, port });
}

export async function setWeb(on: boolean, port?: number): Promise<void> {
  if (!ev()) return;
  if (C.locked) { toast(t("lock.hint")); C.rerender(); return; }
  const st = await bridge.setWeb(on, port);
  if (on && st.error) toast(webError(st.error, st.port, st.holder), true);
}

// ------------------------------------------------------------------ SIGNALE (Phase 4)

export function renderSignals(root: HTMLElement): void {
  const e = ev();
  if (!e) return;
  const s = e.signals;
  const rows: [string, string][] = [
    [t("curfew.entry"), `−${s.entryStopMin}`], [t("curfew.lastRound"), `−${s.lastRoundMin}`], ["curfew-warn", `−${s.curfewWarnMin}`], ["curfew-last", `−${s.curfewLastMin}`],
    [t("notice.next10", { next: "…", min: s.nextDjMin }), `−${s.nextDjMin}`], [t("notice.setEnd5", { min: s.setEndMin }), `−${s.setEndMin}`], [t("notice.over", { floor: "…", over: `+${s.overMin}:00` }), `+${s.overMin}`],
    [t("curfew.houselight"), t(s.houselight === "auto" ? "sig.auto" : "sig.manual")],
  ];
  const list = el("div", "conn-list");
  for (const [name, v] of rows) list.append(el("div", "conn", el("div", "conn-head", el("span", "conn-name", el("b", "", name)), el("span", "conn-st mono", v))));
  root.replaceChildren(el("div", "conn-split", list, el("div", "conn-detail", el("h3", "", iconSpan("info"), " ", t("sig.title")), el("div", "note", t("sig.phase4")), el("p", "hint", t("sig.hint")))));
}

// ------------------------------------------------------------------ VERBINDEN

let connSel: "web" | "suite" | "time" | "guest" = "web";
export function renderConnect(root: HTMLElement): void {
  const st = C.st!;
  const e = ev();
  const items: ["web" | "suite" | "time" | "guest", string, string, string, string][] = [
    ["web", t("conn.web"), t("conn.web.sub", { port: st.web.port }), st.web.on ? t("conn.on", { n: st.web.clients }) : st.web.error ? t("conn.error") : t("conn.off"), st.web.on ? "live" : st.web.error ? "err" : ""],
    ["suite", t("conn.suite"), t("conn.suite.sub"), st.otherLeads.length ? t("conn.twoLeads") : st.suite.listening ? t("conn.on", { n: st.suite.peers }) : st.suite.error ? t("conn.error") : t("conn.off"), st.otherLeads.length ? "warn" : st.suite.listening ? "live" : st.suite.error ? "err" : ""],
    ["time", t("conn.time"), t("conn.time.sub"), t("start.time.system"), "live"],
    ["guest", t("conn.guest"), t("conn.guest.sub"), "", ""],
  ];
  const list = el("div", "conn-list");
  for (const [id, name, sub, status, s] of items) {
    const stEl = el("span", "conn-st", status);
    if (s) stEl.dataset.s = s;
    const head = el("div", "conn-head", el("span", "conn-name", el("b", "", name), el("small", "", sub)), stEl);
    head.setAttribute("data-allow", "");
    head.addEventListener("click", () => { connSel = id; C.rerender(); });
    list.append(el("div", `conn${connSel === id ? " sel" : ""}`, head));
  }
  const det = el("div", "conn-detail");
  if (connSel === "web") {
    const sw = el("input", "switch");
    sw.type = "checkbox"; sw.checked = st.web.on; sw.disabled = !e;
    sw.addEventListener("change", () => { void setWeb(sw.checked); });
    const port = input(String(st.web.port), { cls: "input mono", aria: t("conn.port") });
    port.style.width = "90px";
    port.addEventListener("change", () => {
      const p = Number(port.value);
      if (!Number.isInteger(p) || p < 1024 || p > 65535) { toast(t("conn.port.bad"), true); C.rerender(); return; }
      void setWeb(st.web.on, p);
    });
    det.append(el("h3", "", t("conn.web")),
      setRow(t("start.web.switch"), e ? t("conn.web.forEvent") : t("conn.web.noEvent"), sw),
      setRow(t("conn.port"), t("conn.port.hint"), port),
      st.web.error ? el("div", "note warn", webError(st.web.error, st.web.port, st.web.holder)) : "",
      el("h2", "label", t("conn.addresses")), ...st.addresses.map(a => el("div", "ipl", `http://${a}:${st.web.port}`)),
      el("p", "hint", t("roles.unencrypted")), el("p", "hint", t("conn.web.hint")));
  } else if (connSel === "suite") {
    const sw = el("input", "switch");
    sw.type = "checkbox"; sw.checked = st.prefs.suiteNet;
    sw.addEventListener("change", () => { void bridge.setPrefs({ suiteNet: sw.checked }); });
    det.append(el("h3", "", t("conn.suite")), setRow(t("conn.suite.switch"), t("conn.suite.switch.sub"), sw),
      el("p", "hint", t("conn.suite.status", { port: st.suite.port, n: st.suite.peers })),
      st.suite.error ? el("div", "note warn", t("conn.suite.err", { e: st.suite.error, port: st.suite.port })) : "",
      (() => { const lw = leadWarning(); return lw ? el("div", "note warn", lw.long) : ""; })(),
      el("p", "hint", t("conn.suite.hint")), el("p", "hint", t("conn.bonjour")));
  } else if (connSel === "time") {
    det.append(el("h3", "", t("conn.time")), el("div", "seg", (() => { const b = btn("on", t("start.time.system")); return b; })(), (() => { const b = btn("", `${t("start.time.tc")} · ${t("phase", { n: 4 })}`); b.disabled = true; return b; })()),
      el("p", "hint", t("conn.time.hint")), el("p", "hint", t("conn.time.tc")));
  } else {
    const b = btn("btn", t("conn.netlink"), () => bridge.openNetLink(), "net");
    b.setAttribute("data-allow", "");
    det.append(el("h3", "", t("conn.guest")), el("p", "", t("conn.guest.text")), b);
  }
  root.replaceChildren(el("div", "conn-split", list, det));
}

function setRow(label: string, sub: string, ctl: HTMLElement): HTMLElement {
  return el("div", "set-row", el("span", "set-label", el("b", "", label), el("small", "", sub)), ctl);
}

