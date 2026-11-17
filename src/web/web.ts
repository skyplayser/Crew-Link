// Browser-Seiten von Crew Link (Port 8070): „/“ Rolle wählen, „/r/<rolle>“ (Phase 1: nur lesend, ohne PIN),
// „/uhr/<floor>“ große Uhr, „/oeffentlich“ (nur öffentliche Namen, keine Interna, keine Hinweise).
// Hausuhr über WebSocket (RECHERCHE §1): 8 Proben im Abstand von 100 ms, kürzeste Laufzeit zählt, alle 30 s 4 Proben,
// Gleiten bis 1 s, neu messen bei visibilitychange/pageshow und nach erkanntem Schlaf. Countdowns laufen ohne Netz weiter.
// Nichts wird gespeichert (keine Cookies, kein localStorage). Text aus dem Plan nur als textContent.
import { ClockSync, FIRST_PROBES, FIRST_PROBE_GAP, REPEAT_EVERY, REPEAT_PROBES, msToNextSecond } from "../core/clock";
import { curfewPhase, curfewSequence, dayView, floorStatus, fmtCountdown, cdState, type FloorStatus } from "../core/countdown";
import { setLang, t, getLang } from "../core/i18n";
import { ROLE_PATH, ROLES, type Day, type Role } from "../core/model";
import { route } from "../core/net";
import { nameSlug, noticesFor, type Viewer, type WebPlan, type WebSlot } from "../core/plan";
import { localHM, localHMS, MIN } from "../core/zeit";
import { renderClock } from "../shared/clockview";
import { icon } from "../shared/icons";
import { noticeText } from "../shared/notices";
import { applyTheme, btn, dayLabel, el, floorVar, seg, sq } from "../shared/ui";
import { awakeState, awakeWanted, initAwake, setAwakeWanted, type AwakeState } from "./awake";

const Q = new URLSearchParams(location.search);
const r = route(location.pathname) ?? { page: "choose" as const };
const app = document.getElementById("app")!;
let theme: "day" | "night" = Q.get("theme") === "day" ? "day" : Q.get("theme") === "night" ? "night" : matchMedia("(prefers-color-scheme: light)").matches ? "day" : "night";
setLang(Q.get("lang") === "en" ? "en" : Q.get("lang") === "de" ? "de" : navigator.language.toLowerCase().startsWith("de") ? "de" : "en");
applyTheme(theme);
document.documentElement.lang = getLang();
document.documentElement.dataset.lang = getLang();

const viewer: Viewer = r.page === "role" ? r.role : r.page === "public" ? "public" : r.page === "clock" ? "clock" : "bar";
let plan: WebPlan | null = null;
const sync = new ClockSync();
const dismissed = new Set<string>();
let menuOpen = false;
let lastMsg = 0;      // performance.now() der letzten Nachricht
let everConnected = false;
let ws: WebSocket | null = null;
let pid = 0;
const pending = new Map<number, number>();

const now = (): number => (sync.synced ? sync.now(performance.now()) : Date.now());
const online = (): boolean => !!ws && ws.readyState === WebSocket.OPEN && performance.now() - lastMsg < 5000;

// ------------------------------------------------------------------ Verbindung

function connect(): void {
  try { ws?.close(); } catch { /* egal */ }
  const sock = new WebSocket(`ws://${location.host}/ws`);
  ws = sock;
  sock.onopen = () => {
    everConnected = true;
    lastMsg = performance.now();
    sock.send(JSON.stringify({ t: "hello", view: viewer, ...(r.page === "clock" ? { floor: r.floor } : r.page === "role" && r.role === "booth" && r.sub ? { floor: r.sub } : {}) }));
    void probes(FIRST_PROBES);
  };
  sock.onmessage = m => {
    lastMsg = performance.now();
    let d: Record<string, unknown>;
    try { d = JSON.parse(String(m.data)) as Record<string, unknown>; } catch { return; }
    if (d.t === "pong" && typeof d.id === "number") {
      const t1 = pending.get(d.id);
      pending.delete(d.id);
      if (t1 !== undefined && typeof d.r === "number" && typeof d.s === "number") sync.add(t1, d.r, d.s, performance.now(), Date.now());
    } else if (d.t === "plan") {
      plan = (d.plan as WebPlan | null) ?? null;
      draw();
    } else if (d.t === "tick" && typeof d.rev === "number" && plan && d.rev !== plan.rev) {
      sock.send(JSON.stringify({ t: "hello", view: viewer }));
    }
  };
  sock.onclose = () => { if (ws === sock) ws = null; setTimeout(() => { if (!ws) connect(); }, 2000); };
  sock.onerror = () => { try { sock.close(); } catch { /* egal */ } };
}

async function probes(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const id = ++pid;
    const c = performance.now();
    pending.set(id, c);
    if (pending.size > 32) pending.delete(pending.keys().next().value!);
    ws.send(JSON.stringify({ t: "ping", id, c }));
    await new Promise(res => setTimeout(res, FIRST_PROBE_GAP));
  }
}

// Schlaf erkennen: Wanduhr springt weiter als performance.now() → neu messen
let lastWall = Date.now(), lastPerf = performance.now();
setInterval(() => {
  const w = Date.now(), p = performance.now();
  if ((w - lastWall) - (p - lastPerf) > 1000) { sync.recoverFromWall(p, w); reconnectSoon(); }
  lastWall = w; lastPerf = p;
}, 1000);
function reconnectSoon(): void { setTimeout(() => { if (!online()) connect(); else void probes(FIRST_PROBES); }, 750); }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { reconnectSoon(); draw(); } });
window.addEventListener("pageshow", e => { if (e.persisted) reconnectSoon(); });
setInterval(() => { void probes(REPEAT_PROBES); }, REPEAT_EVERY);

// ------------------------------------------------------------------ Hilfen

function offlineFor(): string {
  return fmtCountdown(performance.now() - lastMsg).replace(/^0(\d:)/, "$1");
}
function sourceText(): string {
  const acc = sync.accuracy;
  return acc === null ? t("web.foot.noSync") : t("web.foot.acc", { src: t("start.time.system"), acc: (Math.max(acc, 5) / 1000).toLocaleString(getLang(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) });
}
function nextDayCard(v: { next: Day; inMs: number }): HTMLElement {
  return el("div", "m-card", el("div", "m-k", t("cd.nextDay"), " · ", el("b", "", `${dayLabel(v.next.date)} ${localHM(v.next.start, plan!.tz)}`)), el("div", "m-big cd idle", fmtCountdown(v.inMs)), el("div", "m-sub", v.next.label));
}
function roleTag(text: string): HTMLElement { return el("span", "role-tag", text); }
function menuBtn(): HTMLElement {
  const b = el("button", "m-menu");
  b.type = "button"; b.setAttribute("aria-label", t("web.menu")); b.append(icon("menu"));
  b.addEventListener("click", () => { menuOpen = true; draw(); });
  return b;
}
function link(href: string): string {
  const p = new URLSearchParams();
  if (Q.get("theme") || theme !== (matchMedia("(prefers-color-scheme: light)").matches ? "day" : "night")) p.set("theme", theme);
  if (Q.get("lang")) p.set("lang", getLang());
  const s = p.toString();
  return href + (s ? `?${s}` : "");
}
function afterText(st: FloorStatus): string {
  if (!st.next) return st.ownEnd ? t("clock.floorEndAt", { time: localHM(st.floorEnd, plan!.tz) }) : "";
  const ready = st.next.readyAt !== undefined ? ` · ${t("clock.ready")}` : "";
  return `${t("clock.after")} ${st.next.name} ${localHM(st.next.start, plan!.tz)}${ready}`;
}
function cdSpan(ms: number, cls?: string): HTMLElement { return el("span", `cd ${cls ?? cdState(ms)}`, fmtCountdown(ms)); }

/** Mini-Zeile je Floor (Leitung, Booth). */
function floorLine(day: Day, f: WebPlan["floors"][0], n: number): HTMLElement {
  const st = floorStatus(plan!, day, f.id, n);
  const row = el("div", "m-floor");
  row.style.setProperty("--c", floorVar(f.color));
  let title = f.name, sub = "", c: HTMLElement;
  if ((st.state === "live" || st.state === "over") && st.cur) {
    title = `${f.name} · ${st.cur.name}`;
    sub = st.state === "over" ? `${t("cd.overWord")} · ${afterText(st)}` : afterText(st);
    c = cdSpan(st.remaining!);
  } else if ((st.state === "before" || st.state === "gap") && st.next) {
    sub = `${t("cd.next")}: ${st.next.name} ${localHM(st.next.start, plan!.tz)}`;
    c = cdSpan(st.nextIn!, st.nextOn ? "next-on" : "next");
  } else {
    sub = st.state === "closed" ? t("tl.closed") : t(st.ownEnd ? "web.floorEnded" : "web.musicEnded", { time: localHM(st.floorEnd, plan!.tz) });
    c = el("span", "cd idle", t("cd.past"));
    c.style.fontSize = "15px";
  }
  row.append(sq(f.color), el("span", "", el("b", "", title), el("small", "", sub)), c);
  return row;
}

function curfewCard(day: Day, n: number, big = true): HTMLElement {
  const tz = plan!.tz;
  if (day.curfew === null) return el("div", "m-card", el("div", "m-k", t("curfew.none")), el("div", "m-sub", t("web.dayEnd", { time: localHM(day.end, tz) })));
  const ph = curfewPhase(day.curfew, n, plan!.signals);
  const left = day.curfew - n;
  const big1 = el("div", `m-big${big ? " mid" : " mid"}${ph === "over" ? " word" : ""}`, ph === "over" ? t("cd.curfewNow") : fmtCountdown(left));
  if (ph === "warn") big1.classList.add("cd", "warn");
  if (ph === "last" || ph === "over") big1.classList.add("cd", "crit");
  const seq = curfewSequence(plan!, day);
  const es = seq.find(s => s.kind === "entryStop"), lr = seq.find(s => s.kind === "lastRound");
  return el("div", `m-card${ph === "warn" ? " warnc" : ph === "last" || ph === "over" ? " over" : ""}`, el("div", "m-k", t("cd.curfew"), " · ", el("b", "", localHM(day.curfew, tz))), big1,
    el("div", "m-sub", [es ? `${t("curfew.entry")} ${localHM(es.at, tz)}` : "", lr ? `${t("curfew.lastRound")} ${localHM(lr.at, tz)}` : ""].filter(Boolean).join(" · ")));
}

// ------------------------------------------------------------------ Seiten

function draw(): void {
  if (r.page === "clock") return drawClock();
  if (r.page === "public") return drawPublic();
  drawMobile();
}

function drawMobile(): void {
  document.body.className = "web";
  const n = now();
  const a = el("div", "m-app");
  if (everConnected && !online()) a.append(el("div", "m-offline", t("web.offline", { t: offlineFor() }), el("small", "", t("web.offline.sub"))));
  else if (!everConnected && !plan) a.append(el("div", "m-offline", t("web.connecting")));
  const st: AwakeState = awakeState();
  if (awakeWanted() && (st === "waiting" || st === "stalled")) a.append(el("button", "m-awake", t(st === "stalled" ? "web.awake.again" : "web.awake.tap")));
  const tz = plan?.tz ?? "Europe/Berlin";
  const time = el("span", "m-time", localHMS(n, tz));
  const role = r.page === "role" ? r.role : null;
  const head = el("div", "m-head");
  if (!role) { const img = el("img", "on-dark"); img.src = "/assets/logo-horizontal-on-dark.svg"; img.alt = "Crew Link"; img.style.height = "22px"; const img2 = el("img", "on-light"); img2.src = "/assets/logo-horizontal-on-light.svg"; img2.alt = "Crew Link"; img2.style.height = "22px"; head.append(img, img2); }
  else head.append(roleTag(roleTitle(role)));
  head.append(time, menuBtn());
  a.append(head);
  // Hinweise (Banner)
  if (role && plan) {
    const djSlots = role === "dj" && r.page === "role" && r.sub ? plan.slots.filter(s => nameSlug(s.name) === r.sub).map(s => s.id) : undefined;
    const floor = role === "booth" && r.page === "role" ? r.sub : undefined;
    for (const x of noticesFor(plan, role, n, { ...(floor ? { floor } : {}), ...(djSlots ? { djSlots } : {}) }).filter(x => !dismissed.has(x.id)).slice(0, 3)) {
      const [h, sub] = noticeText(x, plan, n);
      const close = el("button", "x", "×");
      close.type = "button"; close.setAttribute("aria-label", t("notice.close"));
      close.addEventListener("click", () => { dismissed.add(x.id); draw(); });
      a.append(el("div", `m-banner ${x.tone}`, el("span", "", h, sub ? el("small", "", sub) : ""), close));
    }
  }
  const body = el("div", "m-body");
  a.append(body);
  if (!plan) body.append(el("div", "m-card", el("div", "m-sub", t("web.noPlan"))));
  else if (!role) chooseBody(body, n);
  else roleBody(body, role, n);
  a.append(el("div", `m-foot${online() ? "" : " off"}`, el("span", "dot"), online() ? `Crew Link · ${sourceText()}` : t("web.foot.off", { t: offlineFor() }), el("span", "sep", "·"), t("web.foot.readonly")));
  if (menuOpen) a.append(...menuSheet());
  app.replaceChildren(a);
}

function roleTitle(role: Role): string {
  const base = t(`role.${role}`);
  if (r.page !== "role" || !r.sub || !plan) return base;
  if (role === "booth") return `${base} · ${plan.floors.find(f => f.id === r.sub)?.name ?? r.sub}`;
  if (role === "dj") return `${base} · ${plan.slots.find(s => nameSlug(s.name) === r.sub)?.name ?? r.sub}`;
  return base;
}

function chooseBody(body: HTMLElement, n: number): void {
  const v = dayView(plan!, n);
  const day = v.mode === "running" ? v.day : v.mode === "between" ? v.next : undefined;
  body.append(el("div", "m-k", plan!.name, day ? ` · ${dayLabel(day.date)}` : ""), el("h1", "", t("web.choose.title")));
  (body.lastChild as HTMLElement).style.cssText = "margin:0 0 4px;font-size:22px";
  const roles = el("div", "m-roles");
  for (const role of ROLES) {
    const a = el("a", "m-rolebtn");
    a.href = link(`/r/${ROLE_PATH[role]}`);
    a.append(icon(role), el("span", "", el("b", "", t(`role.${role}`)), el("small", "", t(`role.${role}.sub`))));
    roles.append(a);
  }
  body.append(roles);
}

function roleBody(body: HTMLElement, role: Role, n: number): void {
  const p = plan!;
  const v = dayView(p, n);
  if (v.mode === "between") body.append(nextDayCard(v));
  if (v.mode === "after" || v.mode === "empty") { body.append(el("div", "m-card", el("div", "m-k", t("curfew.after")))); return; }
  if (v.mode !== "running") return;
  const day = v.day;
  const tz = p.tz;
  if (role === "lead") {
    body.append(curfewCard(day, n), el("div", "m-floors", ...p.floors.map(f => floorLine(day, f, n))));
  } else if (role === "booth") {
    const sub = r.page === "role" ? r.sub : undefined;
    const f = sub ? p.floors.find(x => x.id === sub) : p.floors.length === 1 ? p.floors[0] : undefined;
    if (!f) {
      body.append(el("div", "m-k", t("web.chooseFloor")), el("div", "m-roles", ...p.floors.map(x => { const a = el("a", "m-rolebtn", sq(x.color), el("span", "", el("b", "", x.name))); a.href = link(`/r/booth/${x.id}`); return a; })));
      return;
    }
    const st = floorStatus(p, day, f.id, n);
    const card = el("div", `m-card${st.state === "over" ? " over" : ""}`);
    if ((st.state === "live" || st.state === "over") && st.cur) {
      card.append(el("div", "m-k", st.state === "over" ? t("cd.overWord") : t("cd.setEnd"), " · ", el("b", "", st.cur.name)), el("div", `m-big cd ${cdState(st.remaining!)}`, fmtCountdown(st.remaining!)),
        el("div", "m-sub", `${t("web.plannedUntil", { time: localHM(st.cur.end, tz) })}${st.next ? ` · ${afterText(st)}` : ""}`));
    } else if (st.next) {
      card.append(el("div", "m-k", t("cd.next"), " · ", el("b", "", st.next.name)), el("div", `m-big cd ${st.nextOn ? "next-on" : "next"}`, fmtCountdown(st.nextIn!)), el("div", "m-sub", `${localHM(st.next.start, tz)}–${localHM(st.next.end, tz)}`));
    } else card.append(el("div", "m-k", f.name), el("div", "m-big mid cd idle", t("cd.past")));
    body.append(card, el("div", "m-floors", ...p.floors.filter(x => x.id !== f.id).map(x => floorLine(day, x, n)), curfewLine(day, n)));
  } else if (role === "dj") {
    djBody(body, day, n);
  } else if (role === "tech") {
    const ch = p.slots.filter(s => s.day === day.id && s.kind === "changeover" && s.end > n).sort((a, b) => a.start - b.start)[0];
    if (ch) {
      const fl = p.floors.find(f => f.id === ch.floor);
      const running = ch.start <= n;
      const nx = p.slots.filter(s => s.day === day.id && s.floor === ch.floor && s.start >= ch.end).sort((a, b) => a.start - b.start)[0];
      body.append(el("div", "m-card warnc", el("div", "m-k", t("web.changeover", { floor: fl?.name ?? "" }), " · ", el("b", "", running ? t("web.until", { time: localHM(ch.end, tz) }) : t("web.from", { time: localHM(ch.start, tz) }))),
        el("div", `m-big cd ${running ? cdState(ch.end - n) : "next"}`, fmtCountdown(running ? ch.end - n : ch.start - n)), nx ? el("div", "m-sub", `${t("clock.after")} ${nx.name} (${t(`slot.kind.${nx.kind}`)}) ${localHM(nx.start, tz)}–${localHM(nx.end, tz)}`) : ""));
    }
    body.append(el("div", "m-card", el("div", "m-k", t("web.floorEnds")), ...p.floors.map(f => {
      const st = floorStatus(p, day, f.id, n);
      return el("div", "m-line", el("span", "", sq(f.color), f.name), el("span", "", st.state === "closed" ? t("tl.closed") : `${localHM(st.floorEnd, tz)}${st.floorEndIn > 0 ? ` · ${t("cd.in", { t: fmtCountdown(st.floorEndIn) })}` : ` · ${t("cd.past")}`}`));
    })), el("div", "m-floors", ...p.floors.map(f => floorLine(day, f, n))));
  } else if (role === "security") {
    const es = curfewSequence(p, day).find(s => s.kind === "entryStop");
    if (es) body.append(el("div", "m-card", el("div", "m-k", es.at > n ? t("web.entryStopIn") : t("web.entryStopSince")), el("div", "m-big", es.at > n ? fmtCountdown(es.at - n) : localHM(es.at, tz)), el("div", "m-sub", `${t("web.at", { time: localHM(es.at, tz) })} · ${t("cd.curfew")} ${localHM(day.curfew!, tz)}`)));
    body.append(curfewCard(day, n, false), el("div", "m-card", el("div", "m-k", t("web.floorEnds")), ...p.floors.map(f => {
      const st = floorStatus(p, day, f.id, n);
      return el("div", "m-line", el("span", "", sq(f.color), f.name), el("span", "", st.state === "closed" ? t("tl.closed") : st.floorEndIn > 0 ? t("web.until", { time: localHM(st.floorEnd, tz) }) : t("web.closedAt", { time: localHM(st.floorEnd, tz) })));
    })));
  } else if (role === "bar") {
    const lr = curfewSequence(p, day).find(s => s.kind === "lastRound");
    if (lr) body.append(el("div", "m-card", el("div", "m-k", lr.at > n ? t("web.lastRoundIn") : t("curfew.lastRound")), el("div", "m-big", lr.at > n ? fmtCountdown(lr.at - n) : localHM(lr.at, tz)), el("div", "m-sub", t("web.at", { time: localHM(lr.at, tz) }))));
    body.append(curfewCard(day, n, false), el("div", "m-card", el("div", "m-k", t("web.nowThen")), ...p.floors.map(f => {
      const st = floorStatus(p, day, f.id, n);
      const now1 = (st.state === "live" || st.state === "over") && st.cur ? ` · ${st.cur.name}` : "";
      const then = st.next ? (st.state === "over" ? t("web.thenName", { name: st.next.name }) : t("web.fromName", { time: localHM(st.next.start, tz), name: st.next.name })) : st.state === "ended" || st.state === "closed" ? t("web.endAt", { time: localHM(st.floorEnd, tz) }) : "";
      return el("div", "m-line", el("span", "", sq(f.color), `${f.name}${now1}`), el("span", "", then));
    })));
  }
}

function curfewLine(day: Day, n: number): HTMLElement {
  const row = el("div", "m-floor");
  row.style.setProperty("--c", "var(--line)");
  const ic = el("span", "ico"); ic.append(icon("clock")); ic.style.color = "var(--dim)";
  const ph = day.curfew !== null ? curfewPhase(day.curfew, n, plan!.signals) : "normal";
  const c = el("span", `cd${ph === "warn" ? " warn" : ph === "last" || ph === "over" ? " crit" : ""}`, day.curfew === null ? "—" : ph === "over" ? t("cd.curfewNow") : fmtCountdown(day.curfew - n));
  if (ph === "normal") c.style.color = "var(--text)";
  row.append(ic, el("span", "", el("b", "", day.curfew !== null ? t("clock.curfewBar", { time: localHM(day.curfew, plan!.tz) }) : t("curfew.none"))), c);
  return row;
}

function djBody(body: HTMLElement, day: Day, n: number): void {
  const p = plan!, tz = p.tz;
  const sub = r.page === "role" ? r.sub : undefined;
  if (!sub) {
    const names = [...new Map(p.slots.filter(s => s.day === day.id && s.kind !== "changeover" && s.kind !== "break" && s.name && s.end > n).map(s => [nameSlug(s.name), s] as const)).values()];
    body.append(el("div", "m-k", t("web.chooseDj")), el("div", "m-roles", ...names.map(s => { const a = el("a", "m-rolebtn", el("span", "", el("b", "", s.name), el("small", "", `${p.floors.find(f => f.id === s.floor)?.name ?? ""} · ${localHM(s.start, tz)}–${localHM(s.end, tz)}`))); a.href = link(`/r/dj/${nameSlug(s.name)}`); return a; })));
    if (!names.length) body.append(el("div", "m-card", el("div", "m-sub", t("web.noDj"))));
    return;
  }
  const mine = p.slots.filter(s => s.day === day.id && nameSlug(s.name) === sub).sort((a, b) => a.start - b.start);
  let shown: WebSlot | undefined;
  let card: HTMLElement | null = null;
  for (const s of mine) {
    const st = floorStatus(p, day, s.floor, n);
    const fl = p.floors.find(f => f.id === s.floor);
    if (st.cur?.id === s.id && (st.state === "live" || st.state === "over")) {
      shown = s;
      card = el("div", `m-card${st.state === "over" ? " over" : ""}`, el("div", "m-k", st.state === "over" ? t("cd.overWord") : t("web.setEndIn")), el("div", `m-big cd ${cdState(st.remaining!)}`, fmtCountdown(st.remaining!)), el("div", "m-sub", `${fl?.name ?? ""} · ${t("web.until", { time: localHM(s.end, tz) })}${st.next ? ` · ${t("clock.after")} ${st.next.name}` : ""}`));
      break;
    }
    if (s.start > n || st.next?.id === s.id) {
      shown = s;
      const inMs = (st.next?.id === s.id && st.nextIn !== undefined ? st.nextIn : s.start - n);
      const on = inMs <= p.signals.nextDjMin * MIN;
      card = el("div", "m-card", el("div", "m-k", t("cd.youPlayIn")), el("div", `m-big cd ${on ? "next-on" : "next"}`, fmtCountdown(Math.max(0, inMs))), el("div", "m-sub", `${fl?.name ?? ""} · ${localHM(s.start, tz)}–${localHM(s.end, tz)}${day.curfew !== null && s.end >= day.curfew ? ` (${t("web.untilCurfew")})` : ""}`));
      break;
    }
  }
  if (!card || !shown) { body.append(el("div", "m-card", el("div", "m-sub", t("web.djDone")))); body.append(el("div", "m-floors", curfewLine(day, n))); return; }
  body.append(card);
  const before = p.slots.filter(s => s.day === day.id && s.floor === shown!.floor && s.end <= shown!.start + MIN && s.id !== shown!.id).sort((a, b) => b.end - a.end)[0];
  const lines = el("div", "m-card");
  if (before) lines.append(el("div", "m-line", el("span", "", t("web.before")), el("span", "", `${before.name} · ${t("web.until", { time: localHM(before.end, tz) })}`)));
  if (shown.note) lines.append(el("div", "m-line", el("span", "", t("slot.note")), el("span", "", shown.note)));
  lines.append(el("div", "m-line", el("span", "", t("cd.curfew")), el("span", "", day.curfew !== null ? `${localHM(day.curfew, tz)} · ${t("cd.left", { t: fmtCountdown(day.curfew - n) })}` : "—")));
  body.append(lines);
}

// ------------------------------------------------------------------ Menü-Blatt

// ------------------------------------------------------------------ Vollbild (QA Runde 4, Nr. 34)
// iPhone-Safari kennt Vollbild für Seiten nicht (nur für Videos); ältere Safari nur mit webkit-Vorsilbe und ohne
// Promise. Darum vorher prüfen, Fehler abfangen und den Knopf ausblenden, wo es nicht geht.
type FsDoc = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };
const fsDoc = document as FsDoc;
function fullscreenElement(): Element | null { return fsDoc.fullscreenElement ?? fsDoc.webkitFullscreenElement ?? null; }
function canFullscreen(): boolean {
  const d = document.documentElement as FsEl;
  return !!(fsDoc.fullscreenEnabled || fsDoc.webkitFullscreenEnabled) && (typeof d.requestFullscreen === "function" || typeof d.webkitRequestFullscreen === "function");
}
function toggleFullscreen(): void {
  const quiet = (p: unknown) => { if (p && typeof (p as Promise<void>).catch === "function") (p as Promise<void>).catch(() => {}); };
  try {
    if (fullscreenElement()) {
      if (typeof fsDoc.exitFullscreen === "function") quiet(fsDoc.exitFullscreen()); else fsDoc.webkitExitFullscreen?.();
      return;
    }
    if (!canFullscreen()) return;
    const d = document.documentElement as FsEl;
    if (typeof d.requestFullscreen === "function") quiet(d.requestFullscreen()); else d.webkitRequestFullscreen?.();
  } catch { /* Browser ohne Vollbild: nichts tun */ }
}

function menuSheet(): HTMLElement[] {
  const scrim = el("div", "m-scrim");
  scrim.addEventListener("click", () => { menuOpen = false; draw(); });
  const sheet = el("div", "m-sheet");
  sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-label", t("web.menu"));
  const sw = el("input", "switch");
  sw.type = "checkbox"; sw.checked = awakeWanted();
  sw.addEventListener("change", () => setAwakeWanted(sw.checked));
  const full = btn("btn", t("web.menu.full"), () => toggleFullscreen(), "full");
  sheet.append(
    el("div", "m-sheet-row", el("span", "", t("start.theme")), seg<"day" | "night">([["day", t("theme.day")], ["night", t("theme.night")]], theme, v => { theme = v; applyTheme(v); draw(); })),
    el("div", "m-sheet-row", el("span", "", t("start.lang")), seg<"de" | "en">([["de", "DE"], ["en", "EN"]], getLang(), v => { setLang(v); document.documentElement.lang = v; document.documentElement.dataset.lang = v; draw(); })),
    ...(canFullscreen() ? [el("div", "m-sheet-row", el("span", "", t("web.menu.full")), full)] : []),
    el("div", "m-sheet-row", el("span", "", t("web.menu.awake"), el("small", "", t(`web.awake.${awakeState()}`))), sw),
    el("div", "m-sheet-row", el("span", "", t("web.menu.switchRole")), (() => { const a = el("a", "btn", t("web.menu.toChoice")); a.href = link("/"); return a; })()),
    el("div", "m-sheet-row", el("span", "", el("small", "", t("web.menu.privacy")))),
  );
  return [scrim, sheet];
}

// ------------------------------------------------------------------ Große Uhr und öffentliche Seite

let clockMenu = false;
function drawClock(): void {
  document.body.className = "web clock";
  if (r.page !== "clock") return;
  const n = now();
  const off = everConnected && !online() ? t("web.offline.clock", { t: offlineFor() }) : undefined;
  renderClock(app, plan, r.floor, n, { source: online() ? `${t("top.house", { src: t("start.time.system") })} · ${sourceText().split(" · ").pop()}` : t("web.lastSync", { t: offlineFor() }), sourceWarn: !online() && everConnected, ...(off ? { offline: off } : {}), dismissed });
  const band = app.querySelector<HTMLElement>(".clock-band[data-notice]");
  if (band) band.addEventListener("click", ev => { ev.stopPropagation(); dismissed.add(band.dataset.notice!); draw(); });
  const st = awakeState();
  if (awakeWanted() && (st === "waiting" || st === "stalled")) { const b = el("button", "m-awake", t(st === "stalled" ? "web.awake.again" : "web.awake.tap")); b.style.cssText = "position:fixed;left:0;right:0;bottom:0"; app.append(b); }
  if (clockMenu && plan) {
    const m = el("div", "clock-menu",
      ...(canFullscreen() ? [btn("btn", t("web.menu.full"), () => toggleFullscreen(), "full")] : []),
      btn("btn", theme === "day" ? t("theme.night") : t("theme.day"), () => { theme = theme === "day" ? "night" : "day"; applyTheme(theme); draw(); }, theme === "day" ? "moon" : "sun"),
      ...plan.floors.filter(f => f.id !== r.floor).map(f => { const a = el("a", "btn", sq(f.color), f.name); a.href = link(`/uhr/${f.id}`); return a; }),
    );
    app.append(m);
  }
}

function drawPublic(): void {
  document.body.className = "web public";
  const n = now();
  const scr = el("div", "pub-screen");
  if (!plan) { scr.append(el("div", "pub-top", el("span", "pub-name", "Crew Link"), el("span", "pub-time", ""))); app.replaceChildren(scr); return; }
  const tz = plan.tz;
  const v = dayView(plan, n);
  const only = Q.get("floor");
  const floors = only ? plan.floors.filter(f => f.id === only) : plan.floors;
  const day = v.mode === "running" ? v.day : v.mode === "between" ? v.next : undefined;
  if (only && floors.length === 1) scr.classList.add("single");
  scr.style.setProperty("--n", String(Math.max(1, floors.length)));
  scr.append(el("div", "pub-top", el("span", "pub-name", only && floors[0] ? floors[0].name : `${plan.name}${day ? ` · ${day.label || dayLabel(day.date)}` : ""}`), el("span", "pub-time", localHM(n, tz))));
  const cols = el("div", "pub-floors");
  for (const f of floors) {
    const col = el("div", "pub-floor");
    col.style.setProperty("--c", floorVar(f.color));
    if (!day) { col.append(el("span", "pub-k", f.name), el("span", "pub-now closed", t("pub.closed"))); cols.append(col); continue; }
    if (v.mode !== "running") {
      const first = plan.slots.filter(s => s.day === day.id && s.floor === f.id).sort((a, b) => a.start - b.start)[0];
      col.append(el("span", "pub-k", f.name), el("span", "pub-now closed", first ? t("pub.from", { time: localHM(first.start, tz) }) : t("pub.closed")), first ? el("span", "pub-next", t("pub.first"), " ", el("b", "", first.name)) : "");
      cols.append(col); continue;
    }
    const st = floorStatus(plan, day, f.id, n);
    if ((st.state === "live" || st.state === "over") && st.cur) {
      col.append(el("span", "pub-k", only ? t("pub.now") : `${f.name} · ${t("pub.now")}`), el("span", "pub-now", st.cur.name));
      if (st.next) col.append(el("span", "pub-next", ...(st.state === "over" ? [t("pub.then"), " ", el("b", "", st.next.name)] : [t("pub.from", { time: "" }).trim(), " ", el("time", "", localHM(st.next.start, tz)), " ", el("b", "", st.next.name)])));
    } else if ((st.state === "before" || st.state === "gap") && st.next) {
      col.append(el("span", "pub-k", f.name), el("span", "pub-now closed", t("pub.from", { time: localHM(st.next.start, tz) })), el("span", "pub-next", t("pub.first"), " ", el("b", "", st.next.name)));
    } else {
      col.append(el("span", "pub-k", f.name), el("span", "pub-now closed", t("pub.closed")));
      const nd = plan.days.find(d => d.start > n);
      const first = nd && plan.slots.filter(s => s.day === nd.id && s.floor === f.id).sort((a, b) => a.start - b.start)[0];
      if (nd && first) col.append(el("span", "pub-next", `${nd.label || dayLabel(nd.date)} `, t("pub.from", { time: "" }).trim(), " ", el("time", "", localHM(first.start, tz))));
    }
    cols.append(col);
  }
  scr.append(cols);
  if (day && v.mode === "running") scr.append(el("div", "pub-foot", t("pub.musicUntil", { time: localHM(day.curfew ?? day.end, tz) })));
  app.replaceChildren(scr);
}

// ------------------------------------------------------------------ Start

function loop(): void { if (!menuOpen || r.page !== "role") draw(); else updateTimeOnly(); setTimeout(loop, msToNextSecond(now())); }
function updateTimeOnly(): void { const x = document.querySelector(".m-time"); if (x && plan) x.textContent = localHMS(now(), plan.tz); }

if (r.page === "clock" || r.page === "public") {
  app.addEventListener("click", () => {
    if (r.page === "public") { if (!fullscreenElement()) toggleFullscreen(); return; }
    clockMenu = !clockMenu; draw();
    if (clockMenu) setTimeout(() => { clockMenu = false; draw(); }, 6000);
  });
}
initAwake(() => draw());
connect();
loop();
