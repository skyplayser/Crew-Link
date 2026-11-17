// Kleine DOM-Hilfen für Leitstand und Browser-Seiten. Texte aus Plan und Chat nur als textContent, nie als HTML.
import { icon } from "./icons";
import { getLang, t } from "../core/i18n";
import { dayShort, localHM } from "../core/zeit";
import { cdState, fmtCountdown } from "../core/countdown";

type Kids = (Node | string | null | undefined | false)[];

/** Element mit Klasse, Kindern (Text wird Textknoten). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", ...kids: Kids): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k !== null && k !== undefined && k !== false) e.append(typeof k === "string" ? document.createTextNode(k) : k);
  return e;
}

/** Knopf mit optionalem Icon. */
export function btn(cls: string, text: string, onClick?: (e: MouseEvent) => void, ico?: string): HTMLButtonElement {
  const b = el("button", cls);
  b.type = "button";
  if (ico) b.append(icon(ico));
  if (text) b.append(el("span", "", text));
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

export function iconSpan(name: string, cls = "ico"): HTMLSpanElement {
  const s = el("span", cls);
  s.append(icon(name));
  return s;
}

/** Floor-Farbe als CSS-Variable (Reihenfolge Cyan, Lila, Grün, Gelb, Rot). */
export function floorVar(color: number): string { return `var(--floor-${(color % 5) + 1})`; }

export function sq(color: number): HTMLSpanElement {
  const s = el("span", "sq");
  s.style.setProperty("--c", floorVar(color));
  return s;
}

/** Uhrzeit in der Zeitzone der Veranstaltung. */
export function hm(ms: number, tz: string): string { return localHM(ms, tz); }

/** Countdown-Span: Klasse aus dem Zustand (Grenzen im Kern), Text mit „+“ beim Überziehen. */
export function cd(ms: number, extra = ""): HTMLSpanElement {
  const s = el("span", `cd ${cdState(ms)}${extra ? " " + extra : ""}`, fmtCountdown(ms));
  return s;
}

export function dayLabel(date: string): string { return dayShort(date, getLang()); }

/** Segment-Umschalter (aktiv = Text-Fläche). */
export function seg<T extends string>(items: [T, string][], value: T, onPick: (v: T) => void, attrs: Record<string, string> = {}): HTMLDivElement {
  const s = el("div", "seg");
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  for (const [val, label] of items) {
    const b = btn(val === value ? "on" : "", label, () => onPick(val));
    b.setAttribute("aria-pressed", String(val === value));
    s.append(b);
  }
  return s;
}

export function field(label: string, input: HTMLElement, hint?: string): HTMLLabelElement {
  return el("label", "field", el("span", "", label), input, hint ? el("span", "hint", hint) : null);
}

export function input(value: string, o: { cls?: string; placeholder?: string; type?: string; max?: number; aria?: string } = {}): HTMLInputElement {
  const i = el("input", o.cls ?? "");
  i.type = o.type ?? "text";
  i.value = value;
  if (o.placeholder) i.placeholder = o.placeholder;
  if (o.max) i.maxLength = o.max;
  if (o.aria) i.setAttribute("aria-label", o.aria);
  i.spellcheck = false;
  return i;
}

/** Kurze Rückmeldung unten (wie VD .toast). */
let toastTimer = 0;
export function toast(text: string, err = false): void {
  let tEl = document.getElementById("toast");
  if (!tEl) { tEl = el("div", "toast"); tEl.id = "toast"; tEl.setAttribute("role", "status"); document.body.append(tEl); }
  tEl.className = `toast${err ? " err" : ""}`;
  tEl.textContent = text;
  tEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { tEl!.hidden = true; }, 3200);
}

/** Tag/Nacht am <html>: „system“ folgt dem Gerät. */
export function applyTheme(theme: "day" | "night" | "system"): void {
  const dark = theme === "system" ? !matchMedia("(prefers-color-scheme: light)").matches : theme === "night";
  document.documentElement.dataset.theme = dark ? "night" : "day";
}

/** „vorbei“ / Countdown je nach Vorzeichen für Folge-Zeitpunkte (Einlassstopp, Letzte Runde …). */
export function inOrPast(at: number, now: number): string {
  return at > now ? t("cd.in", { t: fmtCountdown(at - now) }) : t("cd.past");
}
