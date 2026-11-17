// Tab TIMETABLE: Tag-Tabs (+ ALLE TAGE, Tag kopieren, + Tag), Zeitleiste mit Ziehen und Ränder ziehen (5-min-Raster,
// ⌥/Alt frei), Liste zum Eintippen, Prüf-Karten, Detailspalte (Slot bzw. Tag und Veranstaltung).
// Aufbau wie design/muster-leitstand.html, Abschnitt 2.
import { checkAll, slotMarks, type Finding } from "../core/check";
import { dayView, floorStatus, fmtCountdown, type FloorStatus } from "../core/countdown";
import { t } from "../core/i18n";
import {
  copyDay, floorById, floorOpen, GapError, makeDay, makeFloor, newId, publicName, SLOT_KINDS, slotsOf, sortDays, timeInDay, toTemplate,
  type CrewEvent, type Day, type Slot, type SlotKind,
} from "../core/model";
import { previewShiftAll, previewShortenNext, applyChanges, shiftFrom } from "../core/shift";
import { addDays, dstTransition, fmtHM, HOUR, localDate, localHM, MIN, parseHM } from "../core/zeit";
import { btn, cd, dayLabel, el, field, floorVar, iconSpan, input, seg, sq, toast } from "../shared/ui";
import { C, bridge, edit, ev, now } from "./ctx";
import { chooseBox, confirmBox, previewDialog } from "./dialogs";
import { openPrint } from "./print";

const SNAP = 5 * MIN;

export function selectedDay(e: CrewEvent): Day | undefined {
  if (C.dayId === "all") return undefined;
  const d = e.days.find(x => x.id === C.dayId);
  if (d) return d;
  const v = dayView(e, now());
  const pick = v.mode === "running" ? v.day : v.mode === "between" ? v.next : v.mode === "after" ? v.last : undefined;
  C.dayId = pick?.id ?? null;
  return pick;
}

// ------------------------------------------------------------------ Aufbau

export function renderTimetable(root: HTMLElement): void {
  const e = ev();
  if (!e) return;
  const day = selectedDay(e);
  const work = el("div", "workarea");
  work.id = "tt-work";
  const head = el("div", "workhead",
    el("h1", "", e.name || t("new.name.default")),
    el("span", "muted", t("tt.facts", { d: e.days.length, f: e.floors.length, s: e.slots.length })),
    el("span", "spacer"),
    seg<"timeline" | "list">([["timeline", t("tl.view.timeline")], ["list", t("tl.view.list")]], C.view, v => { C.view = v; C.rerender(); }, { "data-allow": "" }),
    btn("btn", t("tl.print"), () => openPrint("day"), "print"),
    btn("btn", t("tl.addFloor"), addFloor, "plus"),
    btn("btn primary", t("tl.addSlot"), () => { void addSlot(); }, "plus"),
  );
  work.append(head, dayTabs(e));
  if (C.view === "list") work.append(listView(e));
  else if (C.dayId === "all" || !day) work.append(allDays(e));
  else {
    const tl = el("div", "tl");
    tl.id = "tl";
    work.append(tl, el("div", "checks", ...[]));
    drawTimeline(tl, e, day);
    (work.lastChild as HTMLElement).id = "tt-checks";
    drawChecks(work.lastChild as HTMLElement, e, day);
  }
  const side = el("aside", "side");
  side.id = "tt-side";
  side.setAttribute("aria-label", t("slot.title"));
  drawSide(side, e, day);
  root.replaceChildren(el("div", "main-grid", work, side));
}

/** Jede Sekunde: Zeitleiste (Countdowns, Jetzt-Linie) und Laufend-Kasten neu – nicht während Ziehen oder Tippen. */
export function tickTimetable(): void {
  const e = ev();
  if (!e || C.dragging) return;
  const day = selectedDay(e);
  const tl = document.getElementById("tl");
  if (tl && day && C.view === "timeline") drawTimeline(tl, e, day);
  const live = document.getElementById("side-live");
  if (live && day) drawSideLive(live, e, day);
  const dt = document.getElementById("tt-days");
  if (dt) dt.replaceWith(dayTabs(e));
}

function dayTabs(e: CrewEvent): HTMLElement {
  const wrap = el("div", "days");
  wrap.id = "tt-days";
  wrap.setAttribute("role", "tablist");
  wrap.setAttribute("aria-label", t("days.label"));
  const v = dayView(e, now());
  for (const d of e.days) {
    const running = v.mode === "running" && v.day.id === d.id;
    const dst = dstTransition(d.start, d.end, e.tz);
    const b = el("button", `day${C.dayId === d.id && C.view !== "list" ? " on" : ""}${dst !== null ? " dst" : ""}`);
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(C.dayId === d.id));
    const title = el("b", "", dayLabel(d.date).toUpperCase());
    if (running) title.append(el("span", "running", el("span", "dot"), t("days.running")));
    const sub = `${localHM(d.start, e.tz)}–${localHM(d.end, e.tz)}${d.curfew !== null ? ` · ${t("days.cf")} ${localHM(d.curfew, e.tz)}` : ""}`;
    b.append(title, el("small", "", dst !== null ? dstText(e, d) : sub));
    b.title = d.label;
    b.addEventListener("click", () => { C.dayId = d.id; C.slotId = null; if (C.view === "list") C.listDay = d.id; C.rerender(); });
    wrap.append(b);
  }
  const all = el("button", `day all${C.dayId === "all" ? " on" : ""}`, el("b", "", t("days.all")), el("small", "", t("days.all.sub")));
  all.type = "button";
  all.addEventListener("click", () => { C.dayId = "all"; C.slotId = null; C.view = "timeline"; C.rerender(); });
  wrap.append(all, el("span", "spacer"),
    btn("btn ghost", t("days.copy"), copySelectedDay, "copy"),
    btn("btn ghost", t("days.add"), addDay, "plus"));
  return wrap;
}

/** „Zeitumstellung 03→02“ */
function dstText(e: CrewEvent, d: Day): string {
  const at = dstTransition(d.start, d.end, e.tz)!;
  const before = localHM(at - MIN, e.tz), after = localHM(at, e.tz);
  const h = (s: string) => s.slice(0, 2);
  return t("days.dst", { from: String(Number(h(before)) + 1).padStart(2, "0"), to: h(after) });
}

// ------------------------------------------------------------------ Zeitleiste

interface Span { start: number; end: number }
function span(e: CrewEvent, d: Day): Span {
  let start = d.start, end = d.end;
  for (const s of slotsOf(e, d.id)) { start = Math.min(start, s.start); end = Math.max(end, s.end); }
  return { start: Math.floor(start / HOUR) * HOUR, end: Math.ceil(end / HOUR) * HOUR };
}
const pct = (sp: Span, ms: number) => ((ms - sp.start) / (sp.end - sp.start)) * 100;

function drawTimeline(tl: HTMLElement, e: CrewEvent, d: Day): void {
  const sp = span(e, d);
  const n = now();
  const v = dayView(e, n);
  const running = v.mode === "running" && v.day.id === d.id;
  const marks = slotMarks(checkAll(e, d.id));
  const hours = (sp.end - sp.start) / HOUR;
  tl.style.setProperty("--hour", `${100 / hours}%`);
  const scale = el("div", "");
  for (let h = sp.start; h <= sp.end; h += HOUR) { const s = el("span", "", localHM(h, e.tz)); s.style.left = `${pct(sp, h)}%`; scale.append(s); }
  const rows: HTMLElement[] = [el("div", "tl-scale", el("div"), scale)];
  e.floors.forEach((f, i) => {
    const open = floorOpen(d, f.id);
    const own = d.floors[f.id]?.end;
    const row = el("div", "tl-row");
    row.dataset.floor = f.id;
    row.style.setProperty("--c", floorVar(f.color));
    const sub = !open ? t("tl.closed") : own !== undefined ? t("tl.floorEndAt", { n: i + 1, time: localHM(own, e.tz) }) : t("tl.untilCurfew", { n: i + 1 });
    const lane = el("div", "tl-lane");
    lane.dataset.floor = f.id;
    row.append(el("div", "tl-floor", el("b", "", sq(f.color), f.name), el("small", "", sub)), lane);
    if (!open) lane.append(closed(sp, sp.start, sp.end, t("tl.closed")));
    else if (own !== undefined && own < sp.end) lane.append(closed(sp, own, sp.end, t("tl.floorEnd", { time: localHM(own, e.tz) })));
    const st = running ? floorStatus(e, d, f.id, n) : null;
    const slots = slotsOf(e, d.id, f.id);
    slots.forEach((s, k) => {
      lane.append(slotCard(e, s, sp, st, marks.get(s.id), n, running));
      // Lücke = Umbau (grau)
      const nx = slots[k + 1];
      if (nx && nx.start - s.end >= 5 * MIN && !slots.some(x => x !== s && x !== nx && x.start < nx.start && x.end > s.end)) {
        const g = el("div", "slot gap", el("b", "", t("tl.gap")));
        g.style.setProperty("--s", String(pct(sp, s.end))); g.style.setProperty("--e", String(pct(sp, nx.start)));
        g.title = `${t("tl.gap")} ${localHM(s.end, e.tz)}–${localHM(nx.start, e.tz)}`;
        g.setAttribute("aria-hidden", "true");
        lane.append(g);
      }
    });
    lane.addEventListener("dblclick", ev2 => {
      if ((ev2.target as HTMLElement).closest(".slot:not(.gap)")) return;
      const r = lane.getBoundingClientRect();
      const at = sp.start + ((ev2.clientX - r.left) / r.width) * (sp.end - sp.start);
      void addSlot(f.id, Math.round(at / SNAP) * SNAP);
    });
    lane.addEventListener("click", ev2 => { if (!(ev2.target as HTMLElement).closest(".slot:not(.gap)") && C.slotId) { C.slotId = null; C.rerender(); } });
    rows.push(row);
  });
  if (running) rows.push(line("now", pct(sp, n), t("tl.now", { time: localHM(n, e.tz) })));
  if (d.curfew !== null) rows.push(line("curfew", pct(sp, d.curfew), t("tl.curfew", { time: localHM(d.curfew, e.tz) })));
  tl.replaceChildren(...rows);
}

function closed(sp: Span, a: number, b: number, text: string): HTMLElement {
  const c = el("div", "tl-closed", el("span", "", text));
  c.style.setProperty("--s", String(pct(sp, a))); c.style.setProperty("--e", String(pct(sp, b)));
  return c;
}
function line(kind: "now" | "curfew", at: number, text: string): HTMLElement {
  const l = el("div", `tl-line ${kind}`, el("span", "", text));
  l.style.setProperty("--at", String(Math.max(0, Math.min(100, at))));
  return l;
}

function slotCard(e: CrewEvent, s: Slot, sp: Span, st: FloorStatus | null, mark: "clash" | "late" | undefined, n: number, running: boolean): HTMLElement {
  const cls = ["slot"];
  if (s.kind === "changeover" || s.kind === "break") cls.push("gap");
  if (st) {
    if (st.cur?.id === s.id && st.state === "over") cls.push("over");
    else if (st.cur?.id === s.id && st.state === "live") cls.push("live");
    else if (st.next?.id === s.id) cls.push("next");
    else if (s.end <= n) cls.push("done");
  }
  if (mark) cls.push(mark);
  if (C.slotId === s.id) cls.push("sel");
  const card = el("div", cls.join(" "));
  card.dataset.slot = s.id;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.style.setProperty("--s", String(pct(sp, s.start)));
  card.style.setProperty("--e", String(pct(sp, s.end)));
  const name = el("b", "", s.name || publicName(s) || t("slot.unnamed"));
  if (s.readyAt !== undefined && running) name.append(el("span", "tag ok", t("tl.ready")));
  if (C.st?.changed[s.id]) name.append(el("span", "tag fill-info", t("tl.changed")));
  card.append(name, el("small", "", `${localHM(s.start, e.tz)}–${localHM(s.end, e.tz)}${s.kind !== "dj" ? ` · ${t(`slot.kind.${s.kind}`)}` : ""}`));
  if (s.public.trim() && s.public.trim() !== s.name) card.append(el("span", "pub", t("tl.public", { name: s.public })));
  if (st?.cur?.id === s.id && (st.state === "live" || st.state === "over")) card.append(cd(st.remaining!));
  card.title = `${s.name}${s.public ? ` (${t("tl.public", { name: s.public })})` : ""} · ${localHM(s.start, e.tz)}–${localHM(s.end, e.tz)}`;
  card.append(grip("l"), grip("r"));
  card.addEventListener("pointerdown", ev2 => startDrag(ev2, card, s, sp));
  card.addEventListener("keydown", k => { if (k.key === "Enter" || k.key === " ") { k.preventDefault(); C.slotId = s.id; C.rerender(); } });
  return card;
}
function grip(side: "l" | "r"): HTMLElement { const g = el("span", `grip ${side}`); g.dataset.grip = side; return g; }

/** Ziehen verschiebt, Ränder ziehen ändert die Länge; 5-Minuten-Raster (⌥/Alt: frei). Floor wechseln durch Ziehen in eine andere Zeile. */
function startDrag(pe: PointerEvent, card: HTMLElement, s: Slot, sp: Span): void {
  if (pe.button !== 0 || C.locked) { if (C.locked) { C.slotId = s.id; C.rerender(); } return; }
  const lane = card.parentElement as HTMLElement;
  const width = lane.getBoundingClientRect().width;
  const msPerPx = (sp.end - sp.start) / width;
  const mode = (pe.target as HTMLElement).dataset.grip as "l" | "r" | undefined;
  const x0 = pe.clientX, y0 = pe.clientY;
  let start = s.start, end = s.end, floor = s.floor, moved = false;
  card.setPointerCapture(pe.pointerId);
  const move = (m: PointerEvent) => {
    const dx = m.clientX - x0;
    if (!moved && Math.abs(dx) < 3 && Math.abs(m.clientY - y0) < 3) return;
    if (!moved) { moved = true; C.dragging = true; card.classList.add("drag"); }
    const snap = (v: number) => (m.altKey ? Math.round(v / MIN) * MIN : Math.round(v / SNAP) * SNAP);
    const delta = dx * msPerPx;
    if (mode === "l") { start = Math.min(snap(s.start + delta), s.end - SNAP); end = s.end; }
    else if (mode === "r") { end = Math.max(snap(s.end + delta), s.start + SNAP); start = s.start; }
    else {
      const ns = snap(s.start + delta);
      start = ns; end = ns + (s.end - s.start);
      const under = document.elementsFromPoint(m.clientX, m.clientY).find(x => (x as HTMLElement).dataset?.floor) as HTMLElement | undefined;
      if (under?.dataset.floor) {
        floor = under.dataset.floor;
        const row = under.closest(".tl-row") as HTMLElement | null;
        const targetLane = row?.querySelector(".tl-lane");
        if (targetLane && targetLane !== card.parentElement) targetLane.append(card);
      }
    }
    card.style.setProperty("--s", String(pct(sp, start)));
    card.style.setProperty("--e", String(pct(sp, end)));
    const small = card.querySelector("small");
    if (small) small.textContent = `${localHM(start, ev()!.tz)}–${localHM(end, ev()!.tz)}`;
  };
  const up = () => {
    card.removeEventListener("pointermove", move);
    card.removeEventListener("pointerup", up);
    card.removeEventListener("pointercancel", up);
    C.dragging = false;
    if (!moved) { C.slotId = s.id; C.rerender(); return; }
    card.classList.remove("drag");
    C.slotId = s.id;
    if (start === s.start && end === s.end && floor === s.floor) { C.rerender(); return; }
    void edit(x => { const y = x.slots.find(z => z.id === s.id); if (!y) return false; y.start = start; y.end = end; y.floor = floor; delete y.dstMoved; }, [s.id]).then(() => C.rerender());
  };
  card.addEventListener("pointermove", move);
  card.addEventListener("pointerup", up);
  card.addEventListener("pointercancel", up);
}

// ------------------------------------------------------------------ Prüf-Karten

export function findingText(e: CrewEvent, f: Finding): [string, string] {
  const fl = f.floor ? floorById(e, f.floor)?.name ?? "" : "";
  const names = f.slots.map(id => e.slots.find(s => s.id === id)).filter(Boolean).map(s => `${s!.name || "—"} ${localHM(s!.start, e.tz)}–${localHM(s!.end, e.tz)}`);
  const p = { floor: fl, a: names[0] ?? "", b: names[1] ?? "", min: f.minutes ?? 0, from: f.from !== undefined ? localHM(f.from, e.tz) : "", to: f.to !== undefined ? localHM(f.to, e.tz) : "" };
  if (f.kind === "dst") return [t("check.dst"), t(f.minutes! < 0 ? "check.dst.back" : "check.dst.fwd", { time: p.from })];
  return [t(`check.${f.kind}`, p), t(`check.${f.kind}.sub`, p)];
}

function drawChecks(box: HTMLElement, e: CrewEvent, d: Day): void {
  const all = checkAll(e, d.id);
  const bad = all.filter(f => f.severity !== "info");
  const cards: HTMLElement[] = [];
  if (!bad.length) cards.push(el("div", "card ok", el("b", "", iconSpanColored("check", "var(--ok)"), t("check.ok")), t("check.ok.sub")));
  for (const f of all.slice(0, 8)) {
    const [h, sub] = findingText(e, f);
    const cls = f.severity === "err" ? "err" : f.severity === "warn" ? "warnc" : "";
    const ic = f.severity === "info" ? (f.kind === "dst" ? "clock" : "info") : "alert";
    const col = f.severity === "err" ? "var(--live)" : f.severity === "warn" ? "var(--warn)" : "var(--dim)";
    const card = el("div", `card ${cls}`, el("b", "", iconSpanColored(ic, col), h), sub);
    // „Zeit fiel in die Zeitumstellung – geprüft?“: bestätigen nimmt die Karte weg
    if (f.kind === "dstMoved") card.append(el("div", "", btn("btn small", t("check.dstMoved.ok"), () => { void edit(x => { const y = x.slots.find(z => z.id === f.slots[0]); if (!y) return false; delete y.dstMoved; }); }, "check")));
    cards.push(card);
  }
  const web = C.st?.web;
  cards.push(el("div", "card", el("b", "", iconSpanColored("clock", "var(--dim)"), t("check.house")),
    t("check.house.sub", { src: t("start.time.system"), dst: dstTransition(d.start, d.end, e.tz) !== null ? t("check.house.dst") : t("check.house.noDst"), n: web?.clients ?? 0 })));
  box.replaceChildren(...cards);
}
function iconSpanColored(name: string, color: string): HTMLElement { const s = iconSpan(name); s.style.color = color; return s; }

// ------------------------------------------------------------------ ALLE TAGE

function allDays(e: CrewEvent): HTMLElement {
  const wrap = el("div", "alldays");
  const v = dayView(e, now());
  if (!e.days.length) wrap.append(el("div", "web-off", t("days.none")));
  for (const d of e.days) {
    const sp = span(e, d);
    const bands = el("div", "allday-bands");
    for (const f of e.floors) {
      if (!floorOpen(d, f.id)) continue;
      const b = el("div", "allday-band");
      for (const s of slotsOf(e, d.id, f.id)) {
        const i = el("i");
        i.style.setProperty("--c", floorVar(f.color)); i.style.setProperty("--s", String(pct(sp, s.start))); i.style.setProperty("--e", String(pct(sp, s.end)));
        i.title = `${f.name}: ${s.name} ${localHM(s.start, e.tz)}–${localHM(s.end, e.tz)}`;
        b.append(i);
      }
      bands.append(b);
    }
    const running = v.mode === "running" && v.day.id === d.id;
    const lab = el("b", "", dayLabel(d.date).toUpperCase(), running ? el("span", "running", " ", el("span", "dot"), t("days.running")) : null, el("br"), el("small", "muted", `${d.label ? d.label + " · " : ""}${localHM(d.start, e.tz)}–${localHM(d.end, e.tz)}`));
    const row = el("div", `allday${running ? " on" : ""}`, lab, bands);
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.addEventListener("click", () => { C.dayId = d.id; C.rerender(); });
    row.setAttribute("data-allow", "");
    wrap.append(row);
  }
  return wrap;
}

// ------------------------------------------------------------------ Liste

function listView(e: CrewEvent): HTMLElement {
  const wrap = el("div", "");
  const dSel = el("select", "input");
  dSel.append(new Option(t("list.allDays"), ""));
  for (const d of e.days) dSel.append(new Option(`${dayLabel(d.date)}${d.label ? " · " + d.label : ""}`, d.id));
  dSel.value = C.listDay;
  dSel.addEventListener("change", () => { C.listDay = dSel.value; C.rerender(); });
  const fSel = el("select", "input");
  fSel.append(new Option(t("list.allFloors"), ""));
  for (const f of e.floors) fSel.append(new Option(f.name, f.id));
  fSel.value = C.listFloor;
  fSel.addEventListener("change", () => { C.listFloor = fSel.value; C.rerender(); });
  dSel.setAttribute("data-allow", ""); fSel.setAttribute("data-allow", "");
  dSel.style.width = "auto"; fSel.style.width = "auto";
  wrap.append(el("div", "workhead", el("span", "muted small", t("list.filter")), dSel, fSel));
  const table = el("table", "");
  table.append(el("thead", "", el("tr", "", ...["list.day", "list.floor", "slot.start", "slot.end", "slot.name", "slot.public", "slot.kind", "slot.note", ""].map(k => el("th", "", k ? t(k) : "")))));
  const tb = el("tbody");
  const slots = e.slots.filter(s => (!C.listDay || s.day === C.listDay) && (!C.listFloor || s.floor === C.listFloor))
    .sort((a, b) => a.start - b.start || e.floors.findIndex(f => f.id === a.floor) - e.floors.findIndex(f => f.id === b.floor));
  for (const s of slots) {
    const d = e.days.find(x => x.id === s.day)!;
    const f = floorById(e, s.floor);
    const time = (k: "start" | "end") => {
      const i = input(localHM(s[k], e.tz), { cls: "input time", aria: t(`slot.${k}`) });
      i.style.width = "72px";
      i.addEventListener("change", () => { void setTime(s.id, k, i.value); });
      return i;
    };
    const txt = (k: "name" | "public" | "note", w: string) => {
      const i = input(s[k], { cls: "input", max: k === "note" ? 500 : 48, aria: t(`slot.${k}`) });
      i.style.width = w;
      i.addEventListener("change", () => { void edit(x => { const y = x.slots.find(z => z.id === s.id); if (!y) return false; y[k] = i.value.trim(); }); });
      return i;
    };
    const kind = el("select", "input");
    for (const k of SLOT_KINDS) kind.append(new Option(t(`slot.kind.${k}`), k));
    kind.value = s.kind;
    kind.addEventListener("change", () => { void edit(x => { const y = x.slots.find(z => z.id === s.id); if (!y) return false; y.kind = kind.value as SlotKind; }); });
    const del = btn("btn icon-btn small", "", () => { void deleteSlot(s.id); }, "close");
    del.setAttribute("aria-label", t("slot.delete"));
    const tr = el("tr", "", el("td", "n", dayLabel(d.date)), el("td", "", el("span", "", sq(f?.color ?? 0), " ", f?.name ?? "")), el("td", "", time("start")), el("td", "", time("end")),
      el("td", "", txt("name", "150px")), el("td", "", txt("public", "130px")), el("td", "", kind), el("td", "", txt("note", "200px")), el("td", "", del));
    tb.append(tr);
  }
  if (!slots.length) tb.append(el("tr", "", (() => { const td = el("td", "muted", t("list.empty")); td.colSpan = 9; return td; })()));
  table.append(tb);
  wrap.append(el("div", "table-wrap", table));
  return wrap;
}

// ------------------------------------------------------------------ Detailspalte

function drawSide(side: HTMLElement, e: CrewEvent, day: Day | undefined): void {
  const s = C.slotId ? e.slots.find(x => x.id === C.slotId) : undefined;
  if (s) slotPanel(side, e, s);
  else if (day) dayPanel(side, e, day);
  else eventPanel(side, e);
}

function slotPanel(side: HTMLElement, e: CrewEvent, s: Slot): void {
  const f = floorById(e, s.floor);
  const d = e.days.find(x => x.id === s.day)!;
  const name = input(s.name, { max: 48 });
  name.addEventListener("change", () => { void edit(x => { const y = x.slots.find(z => z.id === s.id); if (!y) return false; y.name = name.value.trim(); }); });
  const pub = input(s.public, { max: 48, placeholder: t("slot.public.ph") });
  pub.addEventListener("change", () => { void edit(x => { const y = x.slots.find(z => z.id === s.id); if (!y) return false; y.public = pub.value.trim(); }); });
  const st = input(localHM(s.start, e.tz), { cls: "time" }), en = input(localHM(s.end, e.tz), { cls: "time" });
  st.addEventListener("change", () => { void setTime(s.id, "start", st.value); });
  en.addEventListener("change", () => { void setTime(s.id, "end", en.value); });
  const kinds = seg<SlotKind>(SLOT_KINDS.map(k => [k, t(`slot.kind.${k}`)]), s.kind, k => { void edit(x => { const y = x.slots.find(z => z.id === s.id); if (!y) return false; y.kind = k; }); });
  const fSel = el("select", "");
  for (const fl of e.floors) fSel.append(new Option(fl.name, fl.id));
  fSel.value = s.floor;
  fSel.addEventListener("change", () => { void edit(x => { const y = x.slots.find(z => z.id === s.id); if (!y) return false; y.floor = fSel.value; }, [s.id]); });
  const note = el("textarea", "");
  note.value = s.note; note.maxLength = 500;
  note.addEventListener("change", () => { void edit(x => { const y = x.slots.find(z => z.id === s.id); if (!y) return false; y.note = note.value.trim(); }); });
  const live = el("div", "side-live");
  live.id = "side-live";
  side.replaceChildren(
    el("h3", "", sq(f?.color ?? 0), t("slot.title"), " · ", f?.name ?? "", el("span", "spacer"), btn("linkish", t("slot.close"), () => { C.slotId = null; C.rerender(); })),
    el("div", "muted small", `${dayLabel(d.date)} · ${localHM(s.start, e.tz)}–${localHM(s.end, e.tz)} · ${durText(s.end - s.start)}`),
    field(t("slot.name"), name),
    field(t("slot.public"), pub, t("slot.public.hint")),
    el("div", "two", field(t("slot.start"), st), field(t("slot.end"), en)),
    el("div", "field", el("span", "", t("slot.kind")), kinds),
    field(t("slot.floor"), fSel),
    field(t("slot.note"), note, t("slot.note.hint")),
    live,
  );
  drawSideLive(live, e, d);
  side.append(btn("btn danger small", t("slot.delete"), () => { void deleteSlot(s.id); }));
  (side.lastChild as HTMLElement).style.justifySelf = "start";
  (side.lastChild as HTMLElement).style.alignSelf = "flex-start";
}

/** Kasten „läuft · Set-Ende“ und die Knöpfe +5 min, Übergabe jetzt, Nächsten kürzen, Alles verschieben. */
function drawSideLive(box: HTMLElement, e: CrewEvent, d: Day): void {
  const s = C.slotId ? e.slots.find(x => x.id === C.slotId) : undefined;
  if (!s) { box.hidden = true; return; }
  const n = now();
  const v = dayView(e, n);
  const st = v.mode === "running" && v.day.id === s.day ? floorStatus(e, v.day, s.floor, n) : null;
  const isCur = !!st && st.cur?.id === s.id && (st.state === "live" || st.state === "over");
  box.hidden = !isCur;
  if (!isCur || !st) { box.replaceChildren(); return; }
  const rows: HTMLElement[] = [el("div", "row", el("span", "cd-word", st.state === "over" ? t("cd.overWord") : t("slot.running")), cd(st.remaining!))];
  if (st.next) {
    const h = el("div", "hint", t("slot.after"), " ", el("b", "", st.next.name), ` ${localHM(st.next.start, e.tz)}`);
    if (st.next.readyAt !== undefined) h.append(" · ", el("span", "", t("clock.ready")));
    rows.push(h);
  }
  const actions = el("div", "actions",
    btn("btn", t("slot.extend"), () => { void extend(s.id); }),
    e.settings.handover === "confirm" && st.next ? btn(st.state === "over" ? "btn primary" : "btn", t("slot.handover"), () => { void handoverNow(s.floor); }) : null,
    st.next ? btn("btn", t("slot.shortenNext"), () => { void shorten(s.id); }) : null,
    btn("btn", t("slot.shiftAll"), () => { void shiftAll(s.id); }),
  );
  box.replaceChildren(...rows, actions);
  void d;
}

function dayPanel(side: HTMLElement, e: CrewEvent, d: Day): void {
  const lab = input(d.label, { max: 40 });
  lab.addEventListener("change", () => { void edit(x => { const y = x.days.find(z => z.id === d.id); if (!y) return false; y.label = lab.value.trim(); }); });
  const time = (k: "start" | "end" | "curfew") => {
    const v = d[k];
    const i = input(v === null ? "" : localHM(v, e.tz), { cls: "time", placeholder: k === "curfew" ? "—" : "HH:MM" });
    i.addEventListener("change", () => { void setDayTime(d.id, k, i.value); });
    return i;
  };
  const floors = el("div", "dayrows");
  for (const f of e.floors) {
    const open = el("input", "check");
    open.type = "checkbox"; open.checked = floorOpen(d, f.id);
    open.setAttribute("aria-label", t("day.floorOpen", { name: f.name }));
    open.addEventListener("change", () => { void edit(x => { const y = x.days.find(z => z.id === d.id)!; y.floors[f.id] = { ...(y.floors[f.id] ?? {}), open: open.checked }; }); });
    const end = input(d.floors[f.id]?.end !== undefined ? localHM(d.floors[f.id]!.end!, e.tz) : "", { cls: "input time", placeholder: t("day.floorEnd.ph"), aria: t("tl.floorEnd", { time: "" }) });
    end.style.width = "74px";
    end.addEventListener("change", () => { void setFloorEnd(d.id, f.id, end.value); });
    floors.append(el("div", "", el("label", "", open, " ", sq(f.color), " ", f.name), " ", end));
  }
  const dst = dstTransition(d.start, d.end, e.tz);
  side.replaceChildren(
    el("h3", "", iconSpan("newEvent"), t("day.title"), " · ", dayLabel(d.date)),
    dst !== null ? el("div", "note warn", t("days.dstNote", { text: dstText(e, d) })) : "",
    field(t("new.days.label"), lab),
    el("div", "three", field(t("new.days.start"), time("start")), field(t("new.days.end"), time("end")), field(t("new.days.curfew"), time("curfew"))),
    el("span", "hint", t("curfew.onlyInput")),
    el("div", "field", el("span", "", t("day.floors")), floors, el("span", "hint", t("day.floors.hint"))),
    btn("btn danger small", t("day.delete"), () => { void deleteDay(d.id); }),
  );
  eventSection(side, e);
}

function eventPanel(side: HTMLElement, e: CrewEvent): void {
  side.replaceChildren(el("h3", "", iconSpan("settings"), t("ev.title")));
  eventSection(side, e);
}

function eventSection(side: HTMLElement, e: CrewEvent): void {
  const name = input(e.name, { max: 80 });
  name.addEventListener("change", () => { void edit(x => { x.name = name.value.trim(); }); });
  const place = input(e.place, { max: 80 });
  place.addEventListener("change", () => { void edit(x => { x.place = place.value.trim(); }); });
  const dc = input(fmtHM(e.dayChange), { cls: "time" });
  dc.addEventListener("change", () => { const m = parseHM(dc.value); if (m === null) { toast(t("err.time", { v: dc.value }), true); return; } void edit(x => { x.dayChange = m; }); });
  const ho = seg<"plan" | "confirm">([["plan", t("ev.handover.plan")], ["confirm", t("ev.handover.confirm")]], e.settings.handover, v => { void edit(x => { x.settings.handover = v; }); });
  const floors = el("div", "dayrows");
  e.floors.forEach((f, i) => {
    const n = input(f.name, { cls: "input", max: 24, aria: t("new.floor.name") });
    n.addEventListener("change", () => { void edit(x => { const y = x.floors.find(z => z.id === f.id); if (!y) return false; y.name = n.value.trim() || y.name; }); });
    const col = el("select", "input");
    ["c1", "c2", "c3", "c4", "c5"].forEach((k, ci) => col.append(new Option(t(`color.${k}`), String(ci))));
    col.value = String(f.color);
    col.style.width = "auto";
    col.addEventListener("change", () => { void edit(x => { const y = x.floors.find(z => z.id === f.id); if (!y) return false; y.color = Number(col.value); }); });
    const up = btn("btn icon-btn small", "↑", () => { void edit(x => { const k = x.floors.findIndex(z => z.id === f.id); if (k <= 0) return false; [x.floors[k - 1], x.floors[k]] = [x.floors[k]!, x.floors[k - 1]!]; }); });
    up.setAttribute("aria-label", t("ev.floorUp"));
    up.disabled = i === 0;
    const del = btn("btn icon-btn small", "", () => { void deleteFloor(f.id); }, "close");
    del.setAttribute("aria-label", t("ev.floorDelete"));
    floors.append(el("div", "", sq(f.color), " ", n, " ", col, " ", up, " ", del));
    (floors.lastChild as HTMLElement).style.cssText = "display:flex;gap:6px;align-items:center";
  });
  side.append(
    el("h3", "", t("ev.title")),
    field(t("new.name"), name), field(t("new.place"), place),
    el("div", "two", field(t("new.dayChange"), dc), field(t("new.tz"), (() => { const i = input(e.tz, {}); i.disabled = true; return i; })())),
    el("div", "field", el("span", "", t("ev.handover")), ho, el("span", "hint", t("ev.handover.hint"))),
    el("div", "field", el("span", "", t("ev.floors")), floors),
    el("div", "", btn("btn small", t("tpl.save"), () => { void bridge.templateSave(toTemplate(e, e.name)).then(r => { if (r.ok) toast(t("tpl.saved")); else if (r.error !== "canceled") toast(t("err.file", { e: r.error }), true); }); }, "template")),
  );
}

// ------------------------------------------------------------------ Aktionen

async function setTime(slotId: string, k: "start" | "end", value: string): Promise<void> {
  const e = ev()!;
  const s = e.slots.find(x => x.id === slotId);
  const d = s && e.days.find(x => x.id === s.day);
  if (!s || !d) return;
  const r = timeInDay(e, d, value);
  if (!r) { toast(t("err.time", { v: value }), true); C.rerender(); return; }
  if (r.gap) { toast(t("err.gap", { v: value, date: dayLabel(localDateOf(e, r.ms)) }), true); C.rerender(); return; }
  let ms = r.ms;
  if (r.ambiguous && r.other !== undefined) {
    const pick = await chooseBox(t("dst.ask.title"), t("dst.ask", { v: value }), [t("dst.summer"), t("dst.winter")]);
    if (pick === null) { C.rerender(); return; }
    ms = pick === 0 ? r.ms : r.other;
  }
  void edit(x => {
    const y = x.slots.find(z => z.id === slotId)!;
    delete y.dstMoved;
    if (k === "start") { const len = y.end - y.start; y.start = ms; if (y.end <= y.start) y.end = y.start + len; }
    else { y.end = ms; if (y.end <= y.start) { toast(t("err.endBeforeStart"), true); return false; } }
  }, [slotId]);
}
function localDateOf(e: CrewEvent, ms: number): string { return localDate(ms, e.tz); }
function durText(ms: number): string { const m = Math.round(ms / MIN); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} h`; }

async function setDayTime(dayId: string, k: "start" | "end" | "curfew", value: string): Promise<void> {
  const e = ev()!;
  const d = e.days.find(x => x.id === dayId)!;
  if (k === "curfew" && !value.trim()) { void edit(x => { x.days.find(z => z.id === dayId)!.curfew = null; }); return; }
  const r = timeInDay(e, d, value);
  if (!r || r.gap) { toast(t("err.time", { v: value }), true); C.rerender(); return; }
  void edit(x => {
    const y = x.days.find(z => z.id === dayId)!;
    if (k === "end" && r.ms <= y.start) { y.end = timeInDay(x, { ...y, date: addDays(y.date, 1) }, value)!.ms; return; }
    y[k] = r.ms;
    if (y.end <= y.start) { toast(t("err.endBeforeStart"), true); return false; }
    sortDays(x);
  });
}

async function setFloorEnd(dayId: string, floorId: string, value: string): Promise<void> {
  const e = ev()!;
  const d = e.days.find(x => x.id === dayId)!;
  if (!value.trim()) { void edit(x => { const y = x.days.find(z => z.id === dayId)!; y.floors[floorId] = { open: floorOpen(y, floorId) }; }); return; }
  const r = timeInDay(e, d, value);
  if (!r || r.gap) { toast(t("err.time", { v: value }), true); C.rerender(); return; }
  void edit(x => { const y = x.days.find(z => z.id === dayId)!; y.floors[floorId] = { open: floorOpen(y, floorId), end: r.ms }; });
}

export async function addSlot(floorId?: string, at?: number): Promise<void> {
  const e = ev();
  if (!e) return;
  const d = selectedDay(e) ?? e.days[0];
  if (!d || !e.floors.length) { toast(t("tt.needDay"), true); return; }
  const f = floorId ?? (C.slotId ? e.slots.find(s => s.id === C.slotId)?.floor : undefined) ?? e.floors[0]!.id;
  const slots = slotsOf(e, d.id, f);
  let start = at ?? (slots.length ? slots[slots.length - 1]!.end : d.start);
  if (start >= (d.curfew ?? d.end)) start = d.start;
  const next = slots.find(s => s.start > start);
  const end = Math.min(start + HOUR, next?.start ?? Infinity, Math.max(start + 30 * MIN, d.curfew ?? d.end));
  const id = "s" + newId(8);
  const ok = await edit(x => { x.slots.push({ id, day: d.id, floor: f, name: "", public: "", kind: "dj", start, end: Math.max(end, start + 15 * MIN), note: "" }); }, [id]);
  if (ok) { C.dayId = d.id; C.slotId = id; C.view = C.view === "list" ? "list" : "timeline"; C.rerender(); setTimeout(() => (document.querySelector("#tt-side input") as HTMLInputElement | null)?.focus(), 50); }
}

async function deleteSlot(id: string): Promise<void> {
  const e = ev()!;
  const s = e.slots.find(x => x.id === id);
  if (!s) return;
  if (!(await confirmBox(t("slot.delete"), t("slot.delete.q", { name: s.name || "—", time: `${localHM(s.start, e.tz)}–${localHM(s.end, e.tz)}` }), t("slot.delete"), true))) return;
  if (await edit(x => { x.slots = x.slots.filter(z => z.id !== id); })) { C.slotId = null; C.rerender(); }
}

function addFloor(): void {
  const e = ev();
  if (!e) return;
  if (e.floors.length >= 12) { toast(t("ev.maxFloors"), true); return; }
  void edit(x => { const f = makeFloor(`Floor ${x.floors.length + 1}`, x.floors.length); x.floors.push(f); for (const d of x.days) d.floors[f.id] = { open: true }; });
}

async function deleteFloor(id: string): Promise<void> {
  const e = ev()!;
  const f = floorById(e, id);
  if (!f || e.floors.length <= 1) { toast(t("ev.lastFloor"), true); return; }
  const n = e.slots.filter(s => s.floor === id).length;
  if (!(await confirmBox(t("ev.floorDelete"), t("ev.floorDelete.q", { name: f.name, n }), t("ev.floorDelete"), true))) return;
  void edit(x => { x.floors = x.floors.filter(z => z.id !== id); x.slots = x.slots.filter(s => s.floor !== id); for (const d of x.days) delete d.floors[id]; });
}

function addDay(): void {
  const e = ev();
  if (!e) return;
  if (e.days.length >= 31) { toast(t("days.max"), true); return; }
  const last = e.days[e.days.length - 1];
  const date = last ? addDays(last.date, 1) : new Date(now()).toISOString().slice(0, 10);
  const hmOf = (ms: number | null) => (ms === null ? "" : localHM(ms, e.tz));
  let day: Day;
  try { day = makeDay(e, { date, label: dayLabel(date), start: last ? hmOf(last.start) : "22:00", end: last ? hmOf(last.end) : "06:00", curfew: last ? hmOf(last.curfew) : "05:00" }); }
  catch (er) { toast(er instanceof GapError ? t("err.gap", { v: er.value, date: dayLabel(er.date) }) : t("err.invalid", { e: String(er) }), true); return; }
  void edit(x => { x.days.push(day); sortDays(x); }).then(ok => { if (ok) { C.dayId = day.id; C.rerender(); } });
}

function copySelectedDay(): void {
  const e = ev();
  const d = e && selectedDay(e);
  if (!e || !d) { toast(t("tt.needDay"), true); return; }
  let date = addDays(d.date, 1);
  while (e.days.some(x => x.date === date)) date = addDays(date, 1);
  const c = copyDay(e, d.id, date, dayLabel(date));
  void edit(x => { x.days.push(c.day); x.slots.push(...c.slots); sortDays(x); }).then(ok => { if (ok) { C.dayId = c.day.id; toast(t("days.copied", { day: dayLabel(date) })); C.rerender(); } });
}

async function deleteDay(id: string): Promise<void> {
  const e = ev()!;
  const d = e.days.find(x => x.id === id)!;
  const n = e.slots.filter(s => s.day === id).length;
  if (!(await confirmBox(t("day.delete"), t("day.delete.q", { day: dayLabel(d.date), n }), t("day.delete"), true))) return;
  if (await edit(x => { x.days = x.days.filter(z => z.id !== id); x.slots = x.slots.filter(s => s.day !== id); })) { C.dayId = null; C.rerender(); }
}

export async function extend(slotId: string): Promise<void> {
  const e = ev()!;
  const s = e.slots.find(x => x.id === slotId);
  if (!s) return;
  // +5 min: Ende später; folgt direkt ein Slot, beginnt er später (Vorschau wie „Nächsten kürzen“)
  const next = slotsOf(e, s.day, s.floor).find(x => x.start >= s.end - MIN && x.id !== s.id);
  const p = next && next.start <= s.end + 5 * MIN
    ? { changes: [{ slot: s.id, from: { start: s.start, end: s.end }, to: { start: s.start, end: s.end + 5 * MIN } }, { slot: next.id, from: { start: next.start, end: next.end }, to: { start: Math.max(next.start, s.end + 5 * MIN), end: next.end } }] }
    : { changes: [{ slot: s.id, from: { start: s.start, end: s.end }, to: { start: s.start, end: s.end + 5 * MIN } }] };
  const r = await previewDialog(e, t("slot.extend"), p);
  if (r === "apply") void edit(x => { Object.assign(x, applyChanges(x, p.changes)); }, p.changes.map(c => c.slot));
}

export async function shorten(slotId: string): Promise<void> {
  const e = ev()!;
  const p = previewShortenNext(e, slotId, now());
  const r = await previewDialog(e, t("slot.shortenNext"), p);
  if (r === "apply") void edit(x => { Object.assign(x, applyChanges(x, p.changes)); }, p.changes.map(c => c.slot));
}

export async function shiftAll(slotId: string): Promise<void> {
  const e = ev()!;
  const s = e.slots.find(x => x.id === slotId)!;
  let p = previewShiftAll(e, slotId, now());
  // noch nicht überzogen: um 5 min verschieben
  if (!p.changes.length) p = shiftFrom(e, s, 5 * MIN, "endOnly");
  const r = await previewDialog(e, t("slot.shiftAll"), p);
  if (r === null) return;
  const changes = r === "suggest" && p.warn?.suggest ? p.changes.map(c => (c.slot === p.warn!.suggest!.slot ? { ...c, to: p.warn!.suggest!.to } : c)) : p.changes;
  void edit(x => { Object.assign(x, applyChanges(x, changes)); }, changes.map(c => c.slot));
}

/** Übergabe jetzt (Übergabe „bestätigen“): der nächste Slot beginnt jetzt; der laufende endet. */
export async function handoverNow(floorId: string): Promise<void> {
  const e = ev()!;
  const n = now();
  const v = dayView(e, n);
  if (v.mode !== "running") return;
  const st = floorStatus(e, v.day, floorId, n);
  if (!st.next) return;
  void edit(x => { const y = x.slots.find(z => z.id === st.next!.id); if (!y) return false; y.handover = n; });
}
