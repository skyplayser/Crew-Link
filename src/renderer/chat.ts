// Suite-Chat am Leitstand – Herkunft: VJ-Link src/renderer/chat.ts (0.1.8, gleicher Autor, EPL-2.0), angepasst:
// Elemente werden hier gebaut (Klassen aus design/components.css), Texte über i18n, Brücke `crew`.
// Chat-Knopf oben mit ungelesenen Nachrichten (pinker Kreis), Chatfenster und EMERGENCY-Popup unten rechts.
// Texte nur als textContent, nie als HTML. Raum: src/core/suitechat.ts, Netz: src/main/chatnet.ts über SuiteNet.
import { t } from "../core/i18n";
import { MAX_ALERTS, admitAlerts, chatWho, type ChatMessage, type ChatPeer, type ChatState } from "../core/suitechat";
import type { CrewBridge } from "../shared/bridge";
import { el } from "../shared/ui";
import { icon } from "../shared/icons";

interface Kept { instance: string; seen: number; open: number[]; down: number[]; unread: number; urgentUnread: boolean }
const KEEP = "crewlink.chat";
const readKept = (): Kept | null => { try { return JSON.parse(sessionStorage.getItem(KEEP) ?? "null") as Kept | null; } catch { return null; } };

function chatTime(at: number): string { return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

export class ChatUi {
  readonly btn: HTMLButtonElement;
  private readonly badge = el("span", "chat-unread");
  private readonly panel = el("div", "chat-panel");
  private readonly list = el("div", "chat-list");
  private readonly peersEl = el("div", "chat-peers");
  private readonly status = el("div", "chat-status");
  private readonly form = el("form", "chat-form");
  private readonly input = el("input");
  private readonly nickForm = el("form", "chat-nick");
  private readonly nickIn = el("input", "big-input");
  private readonly whereIn = el("input", "big-input");
  private readonly rename: HTMLButtonElement;
  private readonly alert = el("div", "chat-alert");
  private readonly alertFrom = el("div", "chat-alert-from");
  private readonly alertText = el("div", "chat-alert-text");
  private readonly alertMore = el("span");
  private readonly alertAll: HTMLButtonElement;
  private on = false; private nick = ""; private where = ""; private last = 0;
  private msgs: ChatMessage[] = []; private peers: ChatPeer[] = [];
  private open = false; private unread = 0; private instance = ""; private renaming = false;
  private alerts: ChatMessage[] = []; private urgentUnread = false; private alertsShown = 0;
  private down = new Set<number>(); private error = ""; private busy = false; private again = false; private shown = "";

  constructor(private readonly bridge: CrewBridge) {
    this.btn = el("button", "btn icon-btn chat-btn");
    this.btn.type = "button"; this.btn.id = "chat-btn";
    this.btn.setAttribute("aria-label", t("top.chat"));
    this.btn.title = t("top.chat");
    this.btn.append(icon("chat"), this.badge);
    this.btn.addEventListener("click", () => this.setOpen(!this.open));
    this.rename = el("button", "linkish", t("chat.rename"));
    this.rename.type = "button";
    this.rename.addEventListener("click", () => { this.renaming = true; this.nickIn.value = this.nick; this.whereIn.value = this.where; this.render(); this.nickIn.focus(); });
    const emergency = el("button", "chat-emergency", "EMERGENCY");
    emergency.type = "button";
    emergency.style.height = "26px";
    emergency.addEventListener("click", () => { void this.send(true); });
    const close = el("button", "btn icon-btn small");
    close.type = "button"; close.setAttribute("aria-label", t("dlg.close")); close.append(icon("close"));
    close.addEventListener("click", () => this.setOpen(false));
    this.panel.append(el("div", "chat-head", el("strong", "", t("chat.title")), this.rename, emergency, close), this.peersEl, this.list, this.status, this.nickForm, this.form);
    this.panel.hidden = true; this.panel.id = "chat-panel";
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-label", t("chat.title"));
    this.nickIn.maxLength = 24; this.whereIn.maxLength = 24;
    this.nickIn.id = "chat-nick"; this.whereIn.id = "chat-where";
    const ok = el("button", "btn primary", t("chat.enter")); ok.type = "submit";
    this.nickForm.append(el("label", "", t("chat.nick.name")), this.nickIn, el("label", "", t("chat.nick.pos")), this.whereIn, el("span", "hint", t("chat.nick.note")), ok);
    this.nickForm.addEventListener("submit", e => {
      e.preventDefault();
      const nick = this.nickIn.value.trim(), where = this.whereIn.value.trim();
      if (!nick) { this.nickIn.focus(); return; }
      this.renaming = false; this.nick = nick; this.where = where;
      void this.bridge.chatProfile(nick, where).then(() => this.poll()).then(() => this.setOpen(true));
    });
    this.input.placeholder = t("chat.placeholder"); this.input.maxLength = 500; this.input.setAttribute("aria-label", t("chat.placeholder"));
    const send = el("button", "btn primary", t("chat.send")); send.type = "submit";
    this.form.append(this.input, send);
    this.form.addEventListener("submit", e => { e.preventDefault(); void this.send(false); });
    this.panel.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); this.setOpen(false); this.btn.focus(); } });
    // EMERGENCY-Popup
    const okBtn = el("button", "btn", t("chat.emergency.ok")); okBtn.type = "button";
    okBtn.addEventListener("click", () => { this.alerts.shift(); this.showAlert(); });
    this.alertAll = el("button", "linkish", t("chat.alert.all")); this.alertAll.type = "button";
    this.alertAll.addEventListener("click", () => { this.alerts.splice(0, this.alertsShown); this.showAlert(); });
    this.alert.setAttribute("role", "alertdialog"); this.alert.setAttribute("aria-label", "EMERGENCY");
    this.alert.append(el("strong", "", "EMERGENCY"), this.alertFrom, this.alertText, el("div", "chat-alert-row", el("span", "", t("chat.emergency.notAlarm"), " ", this.alertMore, " ", this.alertAll), okBtn));
    this.alert.hidden = true;
    document.body.append(this.panel, this.alert);
    window.addEventListener("focus", () => { if (this.open) { this.unread = 0; this.render(); } });
    bridge.onChat(() => { void this.poll(); });
    void this.poll();
    window.setInterval(() => { void this.poll(); }, 5000);
  }

  private async poll(): Promise<void> {
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    let st: ChatState | null = null;
    try { st = await this.bridge.chatGet(this.last); } catch { /* nächstes Mal */ }
    this.busy = false;
    if (this.again) { this.again = false; window.setTimeout(() => { void this.poll(); }, 0); }
    if (!st) { this.on = false; this.render(); return; }
    if ((this.instance && st.instance !== this.instance) || st.last < this.last) {
      this.instance = st.instance; this.last = 0; this.msgs = []; this.shown = ""; this.unread = 0;
      return this.poll();
    }
    const firstLoad = !this.instance;
    this.instance = st.instance;
    const kept = firstLoad ? readKept() : null;
    const seen = kept && kept.instance === st.instance ? kept.seen : -1;
    if (seen >= 0 && kept) {
      this.unread = kept.unread; this.urgentUnread = kept.urgentUnread; this.down = new Set(kept.down);
      const open = new Set(kept.open);
      this.alerts = st.messages.filter(m => open.has(m.n));
    }
    this.on = st.enabled; this.nick = st.nick; this.where = st.where; this.peers = st.peers; this.error = st.error ?? "";
    for (const m of st.messages) if (this.down.has(m.n)) m.urgent = false;
    const fresh = seen >= 0 ? st.messages.filter(m => m.n > seen) : st.messages;
    if (seen >= 0) { this.msgs.push(...st.messages.filter(m => m.n <= seen)); this.msgs.sort((a, b) => a.at - b.at || a.n - b.n); }
    if (fresh.length) {
      this.msgs.push(...fresh);
      this.msgs.sort((a, b) => a.at - b.at || a.n - b.n);
      if (this.msgs.length > 200) this.msgs.splice(0, this.msgs.length - 200);
      const guess = firstLoad && seen < 0;
      const lastSelf = guess ? fresh.map(m => m.self).lastIndexOf(true) : -1;
      const news = fresh.filter((m, i) => !m.self && !m.old && i > lastSelf).length;
      if (news && !(this.open && document.hasFocus())) this.unread += news;
      const { admit, downgrade } = admitAlerts(this.alerts.length, fresh.filter(m => !guess || Date.now() - m.at < 120_000), MAX_ALERTS);
      for (const m of downgrade) { m.urgent = false; this.down.add(m.n); }
      if (admit.length) { this.alerts.push(...admit); if (!this.open) this.urgentUnread = true; if (!firstLoad) this.bridge.chatAttention(); }
    }
    if (fresh.length || seen >= 0) this.showAlert();
    this.last = Math.max(this.last, st.last);
    this.keep();
    this.render(fresh.length > 0);
  }

  private keep(): void {
    if (!this.instance) return;
    const k: Kept = { instance: this.instance, seen: this.last, open: this.alerts.map(m => m.n), down: [...this.down].slice(-200), unread: this.unread, urgentUnread: this.urgentUnread };
    try { sessionStorage.setItem(KEEP, JSON.stringify(k)); } catch { /* ohne Speicher */ }
  }

  setOpen(open: boolean): void {
    this.open = open;
    if (open) { this.unread = 0; this.urgentUnread = false; this.keep(); }
    this.shown = "";
    this.render(true);
    if (open) (this.nick && !this.renaming ? this.input : this.nickIn).focus();
  }

  private render(scroll = false): void {
    this.btn.hidden = !this.on;
    this.btn.classList.toggle("on", this.open);
    if (!this.on || this.open) this.urgentUnread = false;
    this.btn.classList.toggle("urgent", this.urgentUnread);
    this.btn.setAttribute("aria-expanded", String(this.open));
    this.badge.hidden = this.unread === 0;
    this.badge.textContent = this.unread > 9 ? "9+" : String(this.unread);
    this.panel.hidden = !this.on || !this.open;
    if (!this.on) { this.alerts = []; this.msgs = []; this.down.clear(); this.unread = 0; this.shown = ""; this.badge.hidden = true; this.showAlert(); return; }
    if (!this.open) return;
    const asking = !this.nick || this.renaming;
    this.nickForm.hidden = !asking; this.form.hidden = asking; this.rename.hidden = asking;
    const who = this.peers.filter(p => p.nick || p.app).map(p => chatWho(p.nick, p.where, p.app));
    this.peersEl.textContent = who.length ? t("chat.peers", { list: [t("chat.you"), ...who].join(", ") }) : t("chat.alone");
    this.status.textContent = this.error ? t("chat.netError") : "";
    const sig = `${this.msgs.length}:${this.last}`;
    if (sig === this.shown && !scroll) return;
    this.shown = sig;
    const nearEnd = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 40;
    this.list.replaceChildren();
    if (!this.msgs.length) this.list.append(el("div", "chat-empty", t("chat.empty")));
    for (const m of this.msgs) {
      const meta = el("small", "", `${m.urgent ? "EMERGENCY · " : ""}${m.self ? t("chat.you") : chatWho(m.nick, m.where, m.app)} · ${chatTime(m.at)}`);
      this.list.append(el("div", `chat-msg${m.self ? " self" : ""}${m.urgent ? " urgent" : ""}`, meta, el("div", "", m.text)));
    }
    if (scroll || nearEnd) this.list.scrollTop = this.list.scrollHeight;
  }

  private showAlert(): void {
    const m = this.alerts[0];
    this.alertsShown = this.alerts.length;
    this.keep();
    this.alert.hidden = !m;
    if (!m) return;
    this.alertFrom.textContent = `${chatWho(m.nick, m.where, m.app)} · ${chatTime(m.at)}`;
    this.alertText.textContent = m.text;
    this.alertMore.textContent = this.alerts.length > 1 ? t("chat.alert.more", { n: this.alerts.length - 1 }) : "";
    this.alertAll.hidden = this.alerts.length < 2;
  }

  private async send(urgent: boolean): Promise<void> {
    let text = this.input.value.trim();
    if (urgent && !text) text = t("chat.emergency.default");
    if (!text) return;
    this.status.textContent = "";
    const ok = await this.bridge.chatPost(text, urgent).catch(() => false);
    if (ok) this.input.value = "";
    else this.status.textContent = this.nick ? t("chat.notSent") : t("chat.needName");
    await this.poll();
    this.input.focus();
  }
}
