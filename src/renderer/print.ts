// Ausdruck A4 (Druckansicht): je Tag eine Gesamtübersicht und je Floor ein Blatt – groß und schwarz auf weiß, für die
// Wand in der Booth. Dazu: QR-Codes je Rolle (ohne PINs) und das Blatt für die Leitung (mit PINs).
// QR-Codes mit uqr (MIT), offline, schwarz auf weiß mit Ruhezone.
import { encode } from "uqr";
import { t } from "../core/i18n";
import { floorOpen, publicName, ROLE_PATH, ROLES, slotsOf, type CrewEvent, type Role } from "../core/model";
import { localHM } from "../core/zeit";
import { btn, dayLabel, el, sq } from "../shared/ui";
import { C, ev } from "./ctx";
import { selectedDay } from "./timetable";

const NS = "http://www.w3.org/2000/svg";
/** QR-Code als SVG-Element (Fehlerkorrektur M, Ruhezone 4 Module). Nur die Adresse, nie PIN oder Token. */
export function qrSvg(text: string): SVGSVGElement {
  const q = encode(text, { ecc: "M", border: 4 });
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${q.size} ${q.size}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `QR ${text}`);
  const bg = document.createElementNS(NS, "rect");
  bg.setAttribute("width", String(q.size)); bg.setAttribute("height", String(q.size)); bg.setAttribute("fill", "#fff");
  let d = "";
  q.data.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x} ${y}h1v1h-1z`; }));
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", d); p.setAttribute("fill", "#000");
  svg.append(bg, p);
  return svg;
}

export function qrBox(text: string, cls = "qr"): HTMLElement { const s = el("span", cls); s.append(qrSvg(text)); return s; }

export function webBase(): string {
  const st = C.st;
  return `http://${st?.addresses[0] ?? "127.0.0.1"}:${st?.web.port ?? 8070}`;
}
export const rolePath = (r: Role) => `/r/${ROLE_PATH[r]}`;

export function openPrint(kind: "day" | "qr" | "lead"): void {
  const e = ev();
  if (!e) return;
  const wrap = el("div", "print-view");
  const sheets = el("div", "print-sheets");
  const bar = el("div", "print-bar", el("b", "", t(`print.${kind}`)), el("span", "spacer"),
    btn("btn primary", t("print.print"), () => window.print(), "print"),
    btn("btn", t("dlg.close"), () => wrap.remove()));
  if (kind === "day") {
    const sel = el("select", "input");
    sel.style.width = "auto";
    for (const d of e.days) sel.append(new Option(`${dayLabel(d.date)}${d.label ? " · " + d.label : ""}`, d.id));
    sel.value = selectedDay(e)?.id ?? e.days[0]?.id ?? "";
    const draw = () => sheets.replaceChildren(...daySheets(e, sel.value));
    sel.addEventListener("change", draw);
    bar.insertBefore(sel, bar.children[1]!);
    draw();
  } else sheets.append(...roleSheets(e, kind === "lead"));
  wrap.append(bar, sheets);
  const esc = (k: KeyboardEvent) => { if (k.key === "Escape") { wrap.remove(); document.removeEventListener("keydown", esc); } };
  document.addEventListener("keydown", esc);
  document.body.append(wrap);
}

function sheet(...kids: (Node | string)[]): HTMLElement { return el("section", "sheet", ...kids); }

function daySheets(e: CrewEvent, dayId: string): HTMLElement[] {
  const d = e.days.find(x => x.id === dayId);
  if (!d) return [];
  const head = (sub: string) => el("header", "", el("h1", "", e.name), el("p", "", `${dayLabel(d.date)}${d.label ? " · " + d.label : ""} · ${localHM(d.start, e.tz)}–${localHM(d.end, e.tz)}${d.curfew !== null ? " · " + t("clock.curfewBar", { time: localHM(d.curfew, e.tz) }) : ""}`), el("h2", "", sub));
  const out: HTMLElement[] = [];
  // Gesamtübersicht
  const table = el("table", "");
  table.append(el("tr", "", el("th", "", t("list.floor")), el("th", "", t("slot.start")), el("th", "", t("slot.end")), el("th", "", t("slot.name")), el("th", "", t("slot.public"))));
  for (const s of slotsOf(e, d.id)) {
    const f = e.floors.find(x => x.id === s.floor);
    table.append(el("tr", "", el("td", "", f?.name ?? ""), el("td", "", localHM(s.start, e.tz)), el("td", "", localHM(s.end, e.tz)), el("td", "", s.name || "—"), el("td", "", s.public && s.public !== s.name ? s.public : "")));
  }
  out.push(sheet(head(t("print.overview")), table, el("footer", "", t("print.foot"))));
  for (const f of e.floors) {
    if (!floorOpen(d, f.id)) continue;
    const list = el("table", "big");
    for (const s of slotsOf(e, d.id, f.id)) list.append(el("tr", "", el("td", "time", `${localHM(s.start, e.tz)}–${localHM(s.end, e.tz)}`), el("td", "", s.name || publicName(s) || "—", s.kind !== "dj" ? ` (${t(`slot.kind.${s.kind}`)})` : "")));
    const end = d.floors[f.id]?.end;
    out.push(sheet(head(""), el("h2", "", sq(f.color), " ", f.name), list, end !== undefined ? el("p", "", t("tl.floorEnd", { time: localHM(end, e.tz) })) : "", el("footer", "", t("print.foot"))));
  }
  return out;
}

function roleSheets(e: CrewEvent, withPins: boolean): HTMLElement[] {
  const base = webBase();
  const grid = el("div", "print-qr");
  for (const r of ROLES) {
    const pin = withPins ? e.roles.pins[r] : undefined;
    grid.append(el("div", "", el("h3", "", t(`role.${r}`)), qrBox(base + rolePath(r), "qr big"), el("p", "mono", base + rolePath(r)), pin ? el("p", "pin", el("code", "", `${pin.slice(0, 3)} ${pin.slice(3)}`)) : ""));
  }
  grid.append(el("div", "", el("h3", "", t("role.public")), qrBox(base + "/oeffentlich", "qr big"), el("p", "mono", base + "/oeffentlich")));
  const kids: (Node | string)[] = [el("header", "", el("h1", "", e.name), el("h2", "", withPins ? t("print.lead") : t("print.qr"))), grid];
  if (withPins) kids.push(el("p", "", t("print.chatPin", { pin: `${e.roles.chatPin.slice(0, 3)} ${e.roles.chatPin.slice(3)}` })), el("p", "", t("print.pinNote")));
  kids.push(el("p", "", t("roles.unencrypted")), el("footer", "", t("print.foot")));
  return [sheet(...kids)];
}
