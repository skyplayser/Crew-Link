// Dialoge wie VD-Link (.modal): Neue Veranstaltung (3 Schritte: Tage, Zustimmung, Floors), Vorlage, Vorschau einer
// Programmänderung, „Uhr springt“, einfache Rückfragen. Esc schließt.
import { t, getLang } from "../core/i18n";
import {
  builtinTemplates, DEFAULT_DAY_CHANGE, GapError, makeDay, DEFAULT_TZ, fromTemplate, newEvent, publicName, type CrewEvent, type CrewTemplate, type DayInput,
} from "../core/model";
import type { Preview } from "../core/shift";
import { addDays, dayTime, fmtHM, localDate, localHM, parseDate, parseHM, validTimeZone } from "../core/zeit";
import { icon } from "../shared/icons";
import { btn, el, field, input, toast, dayLabel } from "../shared/ui";
import { bridge, now, replace } from "./ctx";

export interface Modal { back: HTMLDivElement; body: HTMLDivElement; foot: HTMLDivElement; close: () => void; head: HTMLDivElement }

export function modal(title: string, o: { steps?: [number, number]; wide?: boolean; onClose?: () => void } = {}): Modal {
  const back = el("div", "modal-back");
  const dlg = el("div", "modal");
  dlg.setAttribute("role", "dialog");
  dlg.setAttribute("aria-modal", "true");
  if (o.wide) dlg.style.width = "min(960px,100%)";
  const h = el("h2", "modal-title", title);
  h.id = "dlg-title-" + Math.random().toString(36).slice(2);
  dlg.setAttribute("aria-labelledby", h.id);
  const head = el("div", "modal-head", h);
  if (o.steps) {
    const dots = el("div", "steps-dots");
    for (let i = 1; i <= o.steps[1]; i++) dots.append(el("i", i <= o.steps[0] ? "on" : ""));
    head.append(dots);
  }
  const body = el("div", "modal-body");
  const foot = el("div", "modal-foot");
  dlg.append(head, body, foot);
  back.append(dlg);
  const close = () => { back.remove(); document.removeEventListener("keydown", esc, true); o.onClose?.(); };
  const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", esc, true);
  document.body.append(back);
  return { back, body, foot, close, head };
}

/** Ja/Nein-Rückfrage. */
export function confirmBox(title: string, text: string, yes: string, danger = false): Promise<boolean> {
  return new Promise(res => {
    let done = false;
    const m = modal(title, { onClose: () => { if (!done) res(false); } });
    m.body.append(el("p", "", text));
    const ok = btn(`btn ${danger ? "danger" : "primary"}`, yes, () => { done = true; m.close(); res(true); });
    m.foot.append(btn("btn", t("dlg.cancel"), () => m.close()), ok);
    ok.focus();
  });
}

/** Auswahl aus mehreren Knöpfen (plus Abbrechen). Ergebnis: Index oder null. */
export function chooseBox(title: string, text: string, options: string[]): Promise<number | null> {
  return new Promise(res => {
    let done = false;
    const m = modal(title, { onClose: () => { if (!done) res(null); } });
    m.body.append(el("p", "", text));
    m.foot.append(btn("btn", t("dlg.cancel"), () => m.close()), ...options.map((o, i) => btn(i === 0 ? "btn primary" : "btn", o, () => { done = true; m.close(); res(i); })));
  });
}

// ------------------------------------------------------------------ Zustimmung (Schritt 2)

export interface ConsentChoice { save: boolean; log: boolean }

function choice(on: boolean, ico: string, title: string, sub: string, pick: () => void): HTMLButtonElement {
  const b = el("button", `choice${on ? " on" : ""}`);
  b.type = "button";
  b.setAttribute("aria-pressed", String(on));
  b.append(icon(ico), el("span", "", el("b", "", title), el("small", "", sub)));
  b.addEventListener("click", pick);
  return b;
}

/** Die zwei Fragen beim Anlegen: Sichern (Vorgabe Ja), Protokoll (Vorgabe Nein). Kein „Später fragen“. */
export function consentBlock(c: ConsentChoice, which: ("save" | "log")[] = ["save", "log"]): HTMLElement {
  const wrap = el("div", "");
  const draw = () => {
    wrap.replaceChildren();
    if (which.includes("save")) wrap.append(el("div", "consent",
      el("h4", "", t("consent.save.q")), el("p", "", t("consent.save.text")),
      el("div", "choice-grid",
        choice(c.save, "check", t("consent.save.yes"), t("consent.save.yes.sub"), () => { c.save = true; draw(); }),
        choice(!c.save, "close", t("consent.save.no"), t("consent.save.no.sub"), () => { c.save = false; draw(); }))));
    if (which.includes("log")) wrap.append(el("div", "consent",
      el("h4", "", t("consent.log.q")), el("p", "", t("consent.log.text")),
      el("div", "choice-grid",
        choice(c.log, "list", t("consent.log.yes"), t("consent.log.yes.sub"), () => { c.log = true; draw(); }),
        choice(!c.log, "close", t("consent.log.no"), t("consent.log.no.sub"), () => { c.log = false; draw(); }))),
      el("p", "hint", t("consent.log.phase")));
  };
  draw();
  return wrap;
}

/** Nur die Frage „Auf diesem Rechner sichern?“ (z. B. vor „Speichern“, wenn vorher Nein gewählt war). */
export function askConsent(which: "save" | "log", current: boolean): Promise<boolean | null> {
  return new Promise(res => {
    let done = false;
    const c: ConsentChoice = { save: which === "save" ? current : false, log: which === "log" ? current : false };
    const m = modal(t("consent.title"), { onClose: () => { if (!done) res(null); } });
    m.body.style.gap = "0";
    m.body.append(consentBlock(c, [which]));
    m.foot.append(btn("btn", t("dlg.cancel"), () => m.close()), btn("btn primary", t("dlg.confirm"), () => { done = true; m.close(); res(which === "save" ? c.save : c.log); }));
  });
}

// ------------------------------------------------------------------ Neue Veranstaltung

interface DayRow { date: string; label: string; start: string; end: string; curfew: string }

export function newEventDialog(pre?: { template: CrewTemplate; name: string; firstDate: string }): void {
  const today = localDate(now(), DEFAULT_TZ);
  const d: { name: string; place: string; tz: string; dayChange: string; days: DayRow[]; floors: { name: string; end: string }[]; consent: ConsentChoice } = {
    name: pre?.name ?? "", place: "", tz: DEFAULT_TZ, dayChange: fmtHM(DEFAULT_DAY_CHANGE),
    days: [{ date: today, label: "", start: "22:00", end: "06:00", curfew: "05:00" }],
    floors: [{ name: "Main", end: "" }],
    consent: { save: true, log: false },
  };
  let step = pre ? 2 : 1;
  const draw = () => {
    const m = modal(pre ? t("tpl.title") : t("new.title"), { steps: [step, pre ? 2 : 3] });
    const next = (s: number) => { m.close(); step = s; draw(); };
    const stepText = el("span", "muted small", t("new.step", { n: pre ? step - 1 : step, m: pre ? 1 : 3 }));
    if (step === 1) {
      const name = input(d.name, { cls: "big-input", max: 80, placeholder: t("new.name.ph") });
      name.addEventListener("input", () => { d.name = name.value; });
      const place = input(d.place, { cls: "big-input", max: 80 });
      place.addEventListener("input", () => { d.place = place.value; });
      m.body.append(el("div", "two", field(t("new.name"), name), field(t("new.place"), place)));
      const rows = el("div", "dayrows");
      const drawRows = () => {
        rows.replaceChildren(el("div", "dayrow headrow", el("span", "", t("new.days.date")), el("span", "", t("new.days.label")), el("span", "", t("new.days.start")), el("span", "", t("new.days.end")), el("span", "", t("new.days.curfew")), el("span")));
        d.days.forEach((row, i) => {
          const date = input(row.date, { cls: "input time", type: "date", aria: t("new.days.date") });
          date.addEventListener("change", () => { row.date = date.value; });
          const lab = input(row.label, { cls: "input", max: 40, placeholder: parseDate(row.date) ? dayLabel(row.date) : "", aria: t("new.days.label") });
          lab.addEventListener("input", () => { row.label = lab.value; });
          const mk = (k: "start" | "end" | "curfew") => { const x = input(row[k], { cls: "input time", aria: t(`new.days.${k}`), placeholder: "HH:MM" }); x.addEventListener("input", () => { row[k] = x.value; }); return x; };
          const del = btn("btn icon-btn small", "", () => { if (d.days.length > 1) { d.days.splice(i, 1); drawRows(); } }, "close");
          del.setAttribute("aria-label", t("new.days.remove"));
          rows.append(el("div", "dayrow", date, lab, mk("start"), mk("end"), mk("curfew"), del));
        });
      };
      drawRows();
      const dc = input(d.dayChange, { cls: "input time", aria: t("new.dayChange") });
      dc.style.width = "70px";
      dc.addEventListener("input", () => { d.dayChange = dc.value; });
      const tz = input(d.tz, { cls: "input", aria: t("new.tz") });
      tz.style.width = "160px";
      tz.addEventListener("input", () => { d.tz = tz.value.trim(); });
      m.body.append(rows, el("div", "", el("div", "", btn("btn", t("new.addDay"), () => {
        const last = d.days[d.days.length - 1]!;
        d.days.push({ ...last, date: parseDate(last.date) ? addDays(last.date, 1) : today, label: "" }); drawRows();
      }, "plus")), el("div", "", "")),
      el("div", "", el("label", "hint", t("new.dayChange"), " ", dc), " ", el("label", "hint", t("new.tz"), " ", tz)),
      el("div", "note", t("new.midnight")),
      el("div", "hint", t("curfew.onlyInput")));
      m.foot.append(stepText, btn("btn", t("dlg.cancel"), () => m.close()), btn("btn primary", t("dlg.next"), () => {
        const err = validateDays(d);
        if (err) { toast(err, true); return; }
        next(2);
      }));
      name.focus();
    } else if (step === 2) {
      m.head.querySelector(".modal-title")!.textContent = t("consent.title");
      m.body.style.gap = "0";
      if (pre) m.body.append(el("p", "hint", t("tpl.applies", { name: pre.template.name, date: dayLabel(pre.firstDate) })));
      m.body.append(consentBlock(d.consent));
      m.foot.append(stepText, btn("btn", pre ? t("dlg.cancel") : t("dlg.back"), () => (pre ? m.close() : next(1))), btn("btn primary", pre ? t("dlg.create") : t("dlg.next"), () => {
        if (pre) {
          const e = fromTemplate(pre.template, { name: pre.name, firstDate: pre.firstDate, consent: d.consent, now: now() });
          m.close(); void replace(e).then(ok => ok && afterCreate());
        } else next(3);
      }));
    } else {
      const list = el("div", "dayrows");
      const drawF = () => {
        list.replaceChildren(el("div", "dayrow headrow", el("span", "", t("new.floor.name")), el("span", "", ""), el("span", "", t("new.floor.end")), el("span"), el("span"), el("span")));
        d.floors.forEach((f, i) => {
          const n = input(f.name, { cls: "input", max: 24, aria: t("new.floor.name") });
          n.addEventListener("input", () => { f.name = n.value; });
          const e = input(f.end, { cls: "input time", placeholder: "—", aria: t("new.floor.end") });
          e.addEventListener("input", () => { f.end = e.value; });
          const sw = el("span", "sq"); sw.style.setProperty("--c", `var(--floor-${(i % 5) + 1})`);
          const del = btn("btn icon-btn small", "", () => { if (d.floors.length > 1) { d.floors.splice(i, 1); drawF(); } }, "close");
          del.setAttribute("aria-label", t("new.floor.remove"));
          list.append(el("div", "dayrow", n, el("span", "", sw), e, el("span"), el("span"), del));
        });
      };
      drawF();
      m.body.append(el("p", "hint", t("new.floor.hint")), list, el("div", "", btn("btn", t("tl.addFloor"), () => { if (d.floors.length < 12) { d.floors.push({ name: `Floor ${d.floors.length + 1}`, end: "" }); drawF(); } }, "plus")));
      m.foot.append(stepText, btn("btn", t("dlg.back"), () => next(2)), btn("btn primary", t("dlg.create"), () => {
        const e = buildEvent(d);
        if (typeof e === "string") { toast(e, true); return; }
        m.close(); void replace(e).then(ok => ok && afterCreate());
      }));
    }
  };
  draw();
}

let afterCreate = () => { /* app.ts setzt: zum Timetable */ };
export function onCreated(fn: () => void): void { afterCreate = fn; }

function validateDays(d: { days: DayRow[]; dayChange: string; tz: string }): string | null {
  if (parseHM(d.dayChange) === null) return t("err.time", { v: d.dayChange });
  if (!validTimeZone(d.tz)) return t("err.tz", { v: d.tz });
  const seen = new Set<string>();
  for (const r of d.days) {
    if (!parseDate(r.date)) return t("err.date", { v: r.date });
    if (seen.has(r.date)) return t("err.dupDate", { v: dayLabel(r.date) });
    seen.add(r.date);
    for (const v of [r.start, r.end]) if (parseHM(v) === null) return t("err.time", { v });
    if (r.curfew.trim() && parseHM(r.curfew) === null) return t("err.time", { v: r.curfew });
    // Uhrzeit in der fehlenden Stunde (Zeitumstellung März): ablehnen, nie still verschieben
    try { makeDay({ tz: d.tz, dayChange: parseHM(d.dayChange)!, floors: [] }, { ...r }); }
    catch (e) { if (e instanceof GapError) return t("err.gap", { v: e.value, date: dayLabel(e.date) }); }
  }
  return null;
}

function buildEvent(d: { name: string; place: string; tz: string; dayChange: string; days: DayRow[]; floors: { name: string; end: string }[]; consent: ConsentChoice }): CrewEvent | string {
  try {
    const ev = newEvent({
      name: d.name.trim() || t("new.name.default"), place: d.place, tz: d.tz, dayChange: parseHM(d.dayChange) ?? DEFAULT_DAY_CHANGE,
      days: d.days.map<DayInput>(r => ({ ...r, label: r.label.trim() || dayLabel(r.date) })), floors: d.floors.map(f => f.name), consent: d.consent, now: now(),
    });
    d.floors.forEach((f, i) => {
      if (!f.end.trim()) return;
      const fl = ev.floors[i]!;
      const m = parseHM(f.end);
      if (m === null) throw new Error(t("err.time", { v: f.end }));
      for (const day of ev.days) {
        const r = dayTime(ev.tz, day.date, m, ev.dayChange);
        if (r.gap) throw new Error(t("err.gap", { v: f.end, date: dayLabel(m >= ev.dayChange ? day.date : addDays(day.date, 1)) }));
        day.floors[fl.id] = { open: true, end: r.ms };
      }
    });
    return ev;
  } catch (e) { return e instanceof GapError ? t("err.gap", { v: e.value, date: dayLabel(e.date) }) : String((e as Error).message); }
}

// ------------------------------------------------------------------ Vorlage

export function templateDialog(): void {
  const m = modal(t("tpl.title"));
  const list = builtinTemplates();
  let picked: CrewTemplate | null = list[0] ?? null;
  const grid = el("div", "choice-grid");
  const name = input("", { cls: "big-input", max: 80, placeholder: t("new.name.ph") });
  const date = input(localDate(now(), DEFAULT_TZ), { cls: "input time", type: "date" });
  const draw = () => {
    grid.replaceChildren();
    for (const tp of list) {
      const days = tp.days.length;
      grid.append(choice(picked === tp, "template", tpName(tp), t("tpl.facts", { d: days, f: tp.floors.length }), () => { picked = tp; draw(); }));
    }
  };
  draw();
  m.body.append(grid, el("div", "", btn("btn", t("tpl.open"), async () => {
    const r = await bridge.templateOpen();
    if (r.ok && r.template) { list.push(r.template); picked = r.template; draw(); }
    else if (r.error && r.error !== "canceled") toast(t("err.file", { e: r.error }), true);
  }, "open")), el("div", "two", field(t("new.name"), name), field(t("tpl.firstDate"), date)), el("p", "hint", t("tpl.note")));
  m.foot.append(btn("btn", t("dlg.cancel"), () => m.close()), btn("btn primary", t("dlg.next"), () => {
    if (!picked) return;
    if (!parseDate(date.value)) { toast(t("err.date", { v: date.value }), true); return; }
    m.close();
    newEventDialog({ template: picked, name: name.value.trim() || tpName(picked), firstDate: date.value });
  }));
}

/** Name einer Vorlage (eingebaute sind schon übersetzt). */
export function tpName(tp: CrewTemplate): string { return tp.name; }

// ------------------------------------------------------------------ Vorschau einer Änderung

export function previewDialog(ev: CrewEvent, title: string, p: Preview): Promise<"apply" | "suggest" | null> {
  return new Promise(res => {
    let done = false;
    const m = modal(title, { onClose: () => { if (!done) res(null); } });
    const ul = el("ul", "");
    ul.style.margin = "0"; ul.style.paddingLeft = "18px";
    for (const c of p.changes) {
      const s = ev.slots.find(x => x.id === c.slot);
      if (!s) continue;
      const shorter = c.to.end - c.to.start < c.from.end - c.from.start;
      ul.append(el("li", "", el("b", "", s.name || publicName(s) || "—"), " ", el("span", "mono", `${localHM(c.from.start, ev.tz)}–${localHM(c.from.end, ev.tz)} → ${localHM(c.to.start, ev.tz)}–${localHM(c.to.end, ev.tz)}`), shorter ? ` (${t("preview.shorter")})` : ""));
    }
    if (!p.changes.length) ul.append(el("li", "muted", t("preview.none")));
    m.body.append(el("p", "hint", t("preview.intro")), ul);
    if (p.warn) {
      const s = ev.slots.find(x => x.id === p.warn!.slot);
      const txt = p.warn.kind === "nothingLeft" ? t("preview.nothingLeft", { name: s?.name ?? "" })
        : t(p.warn.kind === "afterCurfew" ? "check.shiftWarn" : "check.shiftWarnFloor", { min: p.warn.minutes, name: s?.name ?? "" });
      m.body.append(el("div", "note warn", txt));
    }
    m.foot.append(el("span", "muted small", t("preview.never")), btn("btn", t("dlg.cancel"), () => m.close()));
    if (p.warn?.suggest) m.foot.append(btn("btn", t("preview.suggest"), () => { done = true; m.close(); res("suggest"); }));
    const ok = btn("btn primary", t("dlg.confirm"), () => { done = true; m.close(); res("apply"); });
    ok.disabled = !p.changes.length;
    m.foot.append(ok);
  });
}

// ------------------------------------------------------------------ Uhr springt

let jumpOpen = false;
export function clockJumpDialog(deltaMs: number): void {
  if (jumpOpen) return;
  jumpOpen = true;
  let answered = false;
  const m = modal(t("clockJump.title"), { onClose: () => { jumpOpen = false; if (!answered) bridge.clockAnswer(false); } });
  const s = Math.round(deltaMs / 100) / 10;
  m.body.append(el("p", "", t("clockJump.q", { s: (s > 0 ? "+" : "") + s.toLocaleString(getLang()) })), el("p", "hint", t("clockJump.text")));
  m.foot.append(btn("btn", t("clockJump.glide"), () => { answered = true; bridge.clockAnswer(false); m.close(); }), btn("btn primary", t("clockJump.accept"), () => { answered = true; bridge.clockAnswer(true); m.close(); }));
}
