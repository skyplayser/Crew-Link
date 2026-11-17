// Große Uhr (Fenster am Leitstand und /uhr/<floor> im Browser): Quer, ein Floor, lesbar aus 3 m.
// Aufbau wie design/muster-uhr.html. Rechnet nur aus Plan und Hausuhr – läuft ohne Netz weiter.
import { curfewPhase, curfewProgress, dayView, floorStatus, fmtCountdown, cdState } from "../core/countdown";
import { noticesFor, type Notice, type WebPlan } from "../core/plan";
import { t } from "../core/i18n";
import { localHM, localHMS, MIN } from "../core/zeit";
import { el, floorVar, dayLabel } from "./ui";
import { noticeText } from "./notices";

export interface ClockExtra {
  /** „Hausuhr · Systemuhr“ bzw. offline-Hinweis */
  source: string;
  sourceWarn?: boolean;
  /** Offline-Streifen (gelb) statt Hinweis */
  offline?: string;
  dismissed?: Set<string>;
}

export function renderClock(root: HTMLElement, plan: WebPlan | null, floorId: string, now: number, x: ClockExtra): void {
  const screen = el("div", "clock-screen");
  const fl = plan?.floors.find(f => f.id === floorId);
  const fi = plan && fl ? plan.floors.indexOf(fl) : -1;
  screen.style.setProperty("--c", floorVar(fl?.color ?? 0));
  const tz = plan?.tz ?? "Europe/Berlin";
  // Streifen
  let band: HTMLElement = el("div");
  let notices: Notice[] = [];
  if (plan && fl) notices = noticesFor(plan, "booth", now, { floor: fl.id }).filter(n => !x.dismissed?.has(n.id));
  if (x.offline) band = el("div", "clock-band offline", x.offline);
  else if (notices[0]) {
    const n = notices[0];
    const [head, rest] = noticeText(n, plan!, now);
    band = el("div", `clock-band ${n.tone === "warn" ? "warn" : "info"}`, el("b", "", head), rest ? ` · ${rest}` : "");
    band.dataset.notice = n.id;
  }
  const house = el("div", "clock-house", el("b", "", localHMS(now, tz)), el("small", "", x.source));
  if (x.sourceWarn) (house.lastChild as HTMLElement).style.color = "var(--warn)";
  const top = el("div", "clock-top", el("div", "clock-floor", (() => { const s = el("span", "sq"); return s; })(), fl ? t("clock.floor", { n: fi + 1, name: fl.name }) : "—"), house);
  const what = el("div", "clock-what");
  const huge = el("div", "clock-huge cd");
  const next = el("div", "clock-next");
  const curfewT = el("div", "t");
  const track = el("div", "clock-track", el("i"));
  const curfew = el("div", "clock-curfew", curfewT, track);
  screen.append(band, top, what, huge, next, curfew);
  root.replaceChildren(screen);
  if (!plan || !fl) { huge.classList.add("words", "idle"); huge.textContent = t("clock.noFloor"); return; }

  const v = dayView(plan, now);
  const words = (w: string, cls: string) => { huge.classList.add("words", cls); huge.textContent = w; };
  if (v.mode !== "running") {
    if (v.mode === "between") {
      what.append(t("cd.nextDay"), " · ", el("b", "", `${dayLabel(v.next.date)} ${localHM(v.next.start, tz)}`));
      huge.classList.add("idle"); huge.textContent = fmtCountdown(v.inMs);
      const first = plan.slots.filter(s => s.day === v.next.id && s.floor === fl.id).sort((a, b) => a.start - b.start)[0];
      if (first) next.append(t("clock.firstSlot"), " ", el("b", "", first.name), ` ${localHM(first.start, tz)}–${localHM(first.end, tz)}`);
      curfewT.append(el("span", "", t("clock.dayOf", { n: v.index + 1, m: plan.days.length })), el("span", "", plan.name), el("span"));
      (track.firstChild as HTMLElement).style.setProperty("--p", "0");
    } else words(t("cd.past"), "idle");
    return;
  }
  const day = v.day;
  const st = floorStatus(plan, day, fl.id, now);
  const cEnd = day.curfew;
  const cPhase = cEnd !== null ? curfewPhase(cEnd, now, plan.signals) : "normal";
  if (st.state === "over") screen.classList.add("over");
  if (cEnd !== null && cPhase === "over") {
    what.append(t("cd.curfew"), " · ", el("b", "", localHM(cEnd, tz)));
    words(t("cd.curfewNow"), "crit");
  } else if (st.state === "closed") {
    words(t("tl.closed"), "idle");
  } else if (st.state === "live" && st.cur) {
    const lastToCurfew = cEnd !== null && st.cur.end >= cEnd && cEnd - now <= plan.signals.curfewWarnMin * MIN;
    if (lastToCurfew && cEnd !== null) {
      what.append(t("cd.curfew"), " · ", el("b", "", localHM(cEnd, tz)));
      huge.classList.add(cdState(cEnd - now)); huge.textContent = fmtCountdown(cEnd - now);
      next.append(t("clock.setEndAtCurfew", { name: "" }).trim(), " ", el("b", "", st.cur.name));
    } else {
      what.append(t("cd.setEnd"), " · ", el("b", "", st.cur.name));
      huge.classList.add(cdState(st.remaining!)); huge.textContent = fmtCountdown(st.remaining!);
      afterLine(next, plan, st, tz, now);
    }
  } else if (st.state === "over" && st.cur) {
    what.append(t("cd.overWord"), " · ", el("b", "", st.cur.name), " · ", t("clock.planned", { time: localHM(st.cur.end, tz) }));
    huge.classList.add("over"); huge.textContent = fmtCountdown(st.remaining!);
    if (st.next) next.append(t("clock.after"), " ", el("b", "", st.next.name), " · ", t("clock.handoverOpen"));
  } else if ((st.state === "before" || st.state === "gap") && st.next) {
    what.append(st.next.kind === "changeover" ? t("slot.kind.changeover") : t("cd.next"), " · ", el("b", "", st.next.name));
    huge.classList.add(st.nextOn ? "next-on" : "next"); huge.textContent = fmtCountdown(st.nextIn!);
    next.append(el("b", "", st.next.name), ` ${localHM(st.next.start, tz)}–${localHM(st.next.end, tz)}`);
  } else {
    what.append(st.ownEnd ? t("cd.floorEnd") : t("cd.curfew"), " · ", localHM(st.floorEnd, tz));
    words(t("cd.past"), "idle");
  }
  // Balken bis Sperrstunde
  const endAt = cEnd ?? day.end;
  const left = endAt - now;
  const b = el("b", "", left > 0 ? t("cd.left", { t: fmtCountdown(left) }) : t("cd.curfewNow"));
  if (cPhase === "warn") b.className = "warn";
  if (cPhase === "last" || cPhase === "over") b.className = "crit";
  curfewT.append(el("span", "", localHM(day.start, tz)), el("span", "", cEnd !== null ? t("clock.curfewBar", { time: localHM(cEnd, tz) }) : t("clock.dayEnd", { time: localHM(day.end, tz) }), " · ", b), el("span", "", localHM(endAt, tz)));
  if (cPhase === "warn") track.classList.add("warn");
  if (cPhase === "last" || cPhase === "over") track.classList.add("crit");
  (track.firstChild as HTMLElement).style.setProperty("--p", String(Math.round(curfewProgress(day, now))));
}

function afterLine(next: HTMLElement, plan: WebPlan, st: ReturnType<typeof floorStatus>, tz: string, now: number): void {
  if (!st.next) { next.append(st.ownEnd ? t("clock.floorEndAt", { time: localHM(st.floorEnd, tz) }) : ""); return; }
  next.append(t("clock.after"), " ", el("b", "", st.next.name), ` ${localHM(st.next.start, tz)}–${localHM(st.next.end, tz)}`);
  if (st.next.readyAt !== undefined) next.append(" · ", el("span", "ok", t("clock.ready")));
  else if (st.nextOn && st.nextIn !== undefined) next.append(" · ", el("span", "info", t("cd.in", { t: fmtCountdown(st.nextIn) })));
  if (!st.nextOn && st.cur) next.append(" · ", t("clock.handoverFrom", { time: localHM(st.cur.end - plan.signals.nextDjMin * MIN, tz) }));
  void now;
}
