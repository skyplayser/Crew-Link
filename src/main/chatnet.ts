// Suite-Chat am Leitstand über den Suite-Netz-Adapter. Aufbau wie VJ-Link src/main/suitechat.ts (ChatNet, gleicher
// Autor, EPL-2.0), aber ohne eigene Sockets: alles geht über SuiteNet (suite: "chat").
// Name und Position nur im Speicher (Crew Link speichert ohne Zustimmung nichts mit Namen); Texte sowieso nie.
import { performance } from "node:perf_hooks";
import { SuiteChat, type ChatState } from "../core/suitechat";
import type { SuiteNet } from "./suitenet";

export class ChatNet {
  readonly chat: SuiteChat;
  private on = false;
  private tickTimer?: NodeJS.Timeout;
  private notifyTimer?: NodeJS.Timeout;
  private off?: () => void;

  constructor(private readonly net: SuiteNet, private readonly notify: () => void, nick: string, where: string) {
    this.chat = new SuiteChat((json, delay, now) => {
      let obj: Record<string, unknown>;
      try { obj = JSON.parse(json) as Record<string, unknown>; } catch { return; }
      if (now) { this.net.send("chat", obj); return; }
      this.net.send("chat", obj, [Math.max(0, delay)]);
    }, net.peer, "Crew Link");
    this.chat.setProfile(nick, where, performance.now());
  }

  /** Ein/aus (folgt dem Suite-Netz). */
  setOn(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    if (on) {
      this.off = this.net.on("chat", msg => { if (this.chat.receive(JSON.stringify(msg), performance.now())) this.changed(); });
      this.chat.setOn(true, performance.now());
      this.tickTimer = setInterval(() => { if (this.chat.tick(performance.now())) this.changed(); }, 500);
      this.tickTimer.unref();
    } else {
      this.chat.setOn(false, performance.now());
      this.off?.(); this.off = undefined;
      clearInterval(this.tickTimer);
    }
    this.changed();
  }

  state(since: number): ChatState {
    const st = this.chat.state(since);
    return this.net.error ? { ...st, error: this.net.error } : st;
  }

  post(text: unknown, urgent: unknown): boolean {
    const ok = this.chat.post(text, urgent === true);
    if (ok) this.changed();
    return ok;
  }

  profile(nick: unknown, where: unknown): ChatState {
    this.chat.setProfile(nick, where, performance.now());
    this.changed();
    return this.chat.state(0);
  }

  quit(): void { if (this.on) this.chat.stop(); }

  private changed(): void {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => { this.notifyTimer = undefined; this.notify(); }, 80);
  }
}
