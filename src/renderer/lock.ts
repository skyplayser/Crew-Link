// Sperrmodus – Herkunft: VJ-Link src/renderer/lock.ts (0.1.8, gleicher Autor, EPL-2.0), angepasst an Crew Link:
// Sperren mit einem Klick aufs Schloss, Entsperren: Schloss 1 Sekunde halten. Gesperrt ist alles, was den Plan ändert
// (Zeitleiste, Detailspalte, Liste, Dialoge zum Anlegen); erlaubt bleiben Tabs, Tag wählen, Uhr öffnen, Chat, Hinweise.
import { t } from "../core/i18n";
import { icon } from "../shared/icons";

const ALLOW = [".tabs", "#lock-btn", "#chat-btn", ".chat-panel", ".chat-alert", ".day", ".allday", "[data-allow]", "#toast", ".modal-back.allow-locked", ".print-view", ".start"].join(",");
const DENY = [".slot .grip"].join(",");
const HOLD_MS = 1000;
const KEY = "crewlink.locked";

export class ShowLock {
  private on = false;
  private holdTimer = 0;
  private lastHint = 0;
  private justUnlocked = false;

  constructor(private btn: HTMLButtonElement, private toast: (msg: string) => void, private changed: (on: boolean) => void) {
    // nur für die Sitzung (sessionStorage), nichts auf der Platte
    try { this.on = sessionStorage.getItem(KEY) === "1"; } catch { /* ohne Speicher */ }
    this.apply();
    btn.addEventListener("pointerdown", e => {
      if (!this.on) return;
      e.preventDefault();
      btn.classList.add("holding");
      this.holdTimer = window.setTimeout(() => { btn.classList.remove("holding"); this.justUnlocked = true; this.set(false); this.toast(t("lock.unlocked")); }, HOLD_MS);
    });
    const cancel = () => { clearTimeout(this.holdTimer); btn.classList.remove("holding"); };
    btn.addEventListener("pointerup", cancel);
    btn.addEventListener("pointerleave", cancel);
    btn.addEventListener("click", () => {
      if (this.justUnlocked) { this.justUnlocked = false; return; }
      if (this.on) { if (!btn.classList.contains("holding")) this.hint(); return; }
      this.set(true);
      this.toast(t("lock.locked"));
    });
    const block = (e: Event) => {
      if (!this.on) return;
      const tg = e.target as HTMLElement | null;
      if (!tg || !(tg instanceof Element) || this.allowed(tg)) return;
      e.preventDefault(); e.stopPropagation();
      if (e.type === "pointerdown") this.hint();
    };
    for (const ev of ["pointerdown", "mousedown", "click", "dblclick", "dragstart", "contextmenu", "change", "input", "keydown"]) document.addEventListener(ev, e => {
      if (ev === "keydown") { const k = e as KeyboardEvent; if (!this.on || !(k.target instanceof HTMLInputElement || k.target instanceof HTMLTextAreaElement || k.target instanceof HTMLSelectElement)) return; }
      block(e);
    }, true);
  }

  get locked(): boolean { return this.on; }
  allowed(tg: Element): boolean { if (tg.closest(DENY)) return false; return !!tg.closest(ALLOW); }

  set(on: boolean): void {
    this.on = on;
    try { sessionStorage.setItem(KEY, on ? "1" : "0"); } catch { /* ohne Speicher */ }
    this.apply();
    this.changed(on);
  }

  hint(): void {
    const now = Date.now();
    if (now - this.lastHint < 3000) return;
    this.lastHint = now;
    this.toast(t("lock.hint"));
  }

  private apply(): void {
    document.body.classList.toggle("locked", this.on);
    this.btn.classList.toggle("on", this.on);
    this.btn.setAttribute("aria-pressed", String(this.on));
    this.btn.title = this.on ? t("lock.title.on") : t("lock.title.off");
    this.btn.setAttribute("aria-label", this.btn.title);
    this.btn.replaceChildren(icon(this.on ? "lock" : "unlock"));
  }
}
