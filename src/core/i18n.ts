// Texte Deutsch/Englisch für Leitstand, Fenster „Große Uhr“ und Browser-Seiten. Schema wie VD-Link (t("start.new")),
// Schlüssel wie docs/intern/DESIGN.md. Kein fester Text in der Oberfläche; ein Test prüft, dass jeder benutzte Schlüssel in
// beiden Sprachen da ist.
import { DE } from "./i18n-de";
import { EN } from "./i18n-en";

export type Lang = "de" | "en";
export type Key = keyof typeof DE;
let lang: Lang = "de";

export function setLang(l: Lang): void { lang = l === "en" ? "en" : "de"; }
export function getLang(): Lang { return lang; }

/** Text zum Schlüssel; {name} wird ersetzt. Unbekannter Schlüssel: der Schlüssel selbst (fällt im Test auf). */
export function t(key: string, p: Record<string, string | number> = {}): string {
  const dict = (lang === "en" ? EN : DE) as Record<string, string>;
  const s = dict[key] ?? (DE as Record<string, string>)[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in p ? String(p[k]) : m));
}

export function hasKey(key: string): { de: boolean; en: boolean } {
  return { de: key in DE, en: key in (EN as Record<string, string>) };
}
