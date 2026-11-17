// Suite-Netz-Adapter – die einzige Stelle mit Multicast-Sockets. Schnittstelle genau wie suite-net
// (/Users/serato/suite-net/spec/suite-crew.md, „Antworten von suite-net“): send(suite, msg), on(suite, fn) mit
// from.address/from.iface, Optionen port (Testport) und answerProbes (Standard true). Wird später 1:1 durch das
// Paket @link-suite/net ersetzt.
// Regeln wie VJ-Link src/main/suitechat.ts (ChatNet, gleicher Autor, EPL-2.0): Empfangs-Socket 0.0.0.0:<port> mit
// reuseAddr (Geschwister auf demselben Rechner laufen weiter), Gruppe auf jedem IPv4-Adapter (ohne Loopback, 169.254,
// Tunnel), ein Sende-Socket je Adapter, TTL 1, höchstens 8 KB je Datagramm, rejoin alle 30 s.
// probe → echo wie spec/suite-net.md: eine Antwort je Adapter, 0–200 ms zufällig verzögert, höchstens 1/s je NET-Link-peer.
import dgram from "node:dgram";
import os from "node:os";
import { CHAT_GROUP, CHAT_PORT, MAX_DATAGRAM, SendGate, newPeerId } from "../core/suitechat";

export const SUITE_GROUP = CHAT_GROUP;
export const SUITE_PORT = CHAT_PORT;
/** Testport von Crew Link (suite-net: eingetragen). Automatische Tests nie auf 47676. */
export const TEST_PORT = 47681;

export interface SuiteFrom { address: string; iface: string }
export type SuiteHandler = (msg: unknown, from: SuiteFrom) => void;
export interface SuiteNetOptions { port?: number; answerProbes?: boolean; app: string; ver: string; peer?: string }

interface Adapter { address: string; netmask: string }

/** IPv4-Adapter für die Suite: nicht Loopback, nicht 169.254.x.x, keine Tunnel (VPN) – wie VJ-Link adapters(). */
export function adapters(): Adapter[] {
  const out: Adapter[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const n of list ?? []) {
    if (n.family !== "IPv4" || n.internal || n.address.startsWith("169.254.")) continue;
    if (/^(utun|ipsec|ppp|tun|gif|stf)\d*$/i.test(name) || n.netmask === "255.255.255.255") continue;
    if (!out.some(a => a.address === n.address)) out.push({ address: n.address, netmask: n.netmask });
  }
  return out;
}

const toNum = (ip: string) => ip.split(".").reduce((a, b) => ((a << 8) >>> 0) + Number(b), 0) >>> 0;
/** Über welchen Adapter kam ein Datagramm? (gleiches Teilnetz; sonst der erste) */
export function ifaceFor(address: string, list: Adapter[]): string {
  if (address.startsWith("127.") || list.some(a => a.address === address)) return list.find(a => a.address === address)?.address ?? address;
  const n = toNum(address);
  for (const a of list) { const m = toNum(a.netmask); if ((n & m) === (toNum(a.address) & m)) return a.address; }
  return list[0]?.address ?? "";
}

export class SuiteNet {
  readonly peer: string;
  readonly port: number;
  private readonly answerProbes: boolean;
  private recv?: dgram.Socket;
  private readonly joined = new Set<string>();
  private readonly senders = new Map<string, { sock: dgram.Socket; ready: boolean }>();
  private readonly handlers = new Map<string, Set<SuiteHandler>>();
  private readonly probeSeen = new Map<string, number>();
  private rejoinTimer?: NodeJS.Timeout;
  private starting?: Promise<void>;
  private readonly gate = new SendGate();
  private list: Adapter[] = [];
  error?: string;

  constructor(private readonly o: SuiteNetOptions) {
    this.peer = o.peer ?? newPeerId(12);
    this.port = o.port ?? SUITE_PORT;
    this.answerProbes = o.answerProbes !== false;
  }

  get listening(): boolean { return !!this.recv; }
  status(): { listening: boolean; adapters: string[]; error?: string; port: number } {
    return { listening: this.listening, adapters: this.list.map(a => a.address), port: this.port, ...(this.error ? { error: this.error } : {}) };
  }

  start(): Promise<void> {
    if (this.starting) return this.starting;
    this.error = undefined;
    this.starting = new Promise<void>(resolve => {
      const s = dgram.createSocket({ type: "udp4", reuseAddr: true });
      this.recv = s;
      s.on("message", (buf, rinfo) => this.onDatagram(buf, rinfo.address));
      s.on("error", err => {
        // Port nicht nutzbar: Suite-Netz bleibt aus, alles andere läuft weiter.
        this.error = (err as NodeJS.ErrnoException).code ?? err.message;
        try { s.close(); } catch { /* zu */ }
        if (this.recv === s) { this.recv = undefined; this.starting = undefined; }
        resolve();
      });
      s.bind(this.port, async () => {
        try { s.setMulticastTTL(1); s.setMulticastLoopback(true); } catch { /* egal */ }
        await this.rejoin();
        if (this.recv !== s) { resolve(); return; }
        this.rejoinTimer = setInterval(() => { void this.rejoin(); }, 30_000);
        this.rejoinTimer.unref();
        resolve();
      });
    });
    return this.starting;
  }

  /** Sendet `bye` sofort und schließt die Sockets. */
  stop(): void {
    if (!this.recv) return;
    this.sendNow({ suite: "crew", v: 1, t: "bye", peer: this.peer }, true);
    const recv = this.recv, senders = [...this.senders.values()];
    this.recv = undefined; this.starting = undefined;
    this.senders.clear(); this.joined.clear(); this.gate.reset();
    clearInterval(this.rejoinTimer);
    setTimeout(() => {
      for (const x of senders) { try { x.sock.close(); } catch { /* zu */ } }
      try { recv.close(); } catch { /* zu */ }
    }, 100).unref();
  }

  /** Ein JSON-Objekt an die Suite; `suite`, `v` und `peer` setzt der Adapter. Über 8 KB: verworfen. `delays`: Wiederholungen (ms). */
  send(suite: string, msg: Record<string, unknown>, delays: number[] = [0]): boolean {
    const full = { suite, v: 1, peer: this.peer, ...msg };
    full.suite = suite;
    const len = Buffer.byteLength(JSON.stringify(full), "utf8");
    if (len > MAX_DATAGRAM) return false;
    for (const d of delays) {
      if (d <= 0) { this.sendNow(full); continue; }
      if (!this.gate.take()) continue;
      setTimeout(() => { this.gate.done(); this.sendNow(full); }, d).unref();
    }
    return true;
  }

  /** Nur Datagramme mit diesem `suite`-Wert; eigene fallen weg. Gibt eine Abmelde-Funktion zurück. */
  on(suite: string, fn: SuiteHandler): () => void {
    let set = this.handlers.get(suite);
    if (!set) { set = new Set(); this.handlers.set(suite, set); }
    set.add(fn);
    return () => { set!.delete(fn); };
  }

  private onDatagram(buf: Buffer, address: string): void {
    if (buf.length > MAX_DATAGRAM) return;
    let m: unknown;
    try { m = JSON.parse(buf.toString("utf8")); } catch { return; }
    if (!m || typeof m !== "object" || Array.isArray(m)) return;
    const o = m as Record<string, unknown>;
    if (typeof o.suite !== "string" || o.peer === this.peer) return;
    const from = { address, iface: ifaceFor(address, this.list) };
    if (o.suite === "net" && o.t === "probe" && this.answerProbes) this.answerProbe(o);
    const set = this.handlers.get(o.suite);
    if (set) for (const fn of set) { try { fn(m, from); } catch { /* ein Fehler im Empfänger bricht das Netz nicht */ } }
  }

  /** probe → echo: je Adapter eine Antwort, 0–200 ms zufällig verzögert, höchstens 1/s je NET-Link-peer. */
  private answerProbe(p: Record<string, unknown>): void {
    const to = typeof p.peer === "string" && /^[0-9a-z]{8,32}$/.test(p.peer) ? p.peer : "";
    const seq = typeof p.seq === "number" && Number.isFinite(p.seq) ? p.seq : null;
    if (!to || seq === null) return;
    const now = Date.now();
    if (now - (this.probeSeen.get(to) ?? -Infinity) < 1000) return;
    this.probeSeen.set(to, now);
    if (this.probeSeen.size > 64) this.probeSeen.delete(this.probeSeen.keys().next().value!);
    for (const [ip, x] of this.senders) {
      if (!this.gate.take()) return;
      const echo = Buffer.from(JSON.stringify({ suite: "net", v: 1, t: "echo", peer: this.peer, app: this.o.app, ver: this.o.ver, to, seq, ip }), "utf8");
      setTimeout(() => {
        this.gate.done();
        if (x.ready && this.recv) x.sock.send(echo, this.port, SUITE_GROUP, () => { /* Adapter weg: rejoin merkt es */ });
      }, Math.floor(Math.random() * 201)).unref();
    }
  }

  private async rejoin(): Promise<void> {
    const s = this.recv;
    if (!s) return;
    this.list = adapters();
    const now = this.list.map(a => a.address);
    for (const ip of [...this.joined]) if (!now.includes(ip)) { try { s.dropMembership(SUITE_GROUP, ip); } catch { /* weg */ } this.joined.delete(ip); }
    for (const [ip, x] of [...this.senders]) if (!now.includes(ip)) { try { x.sock.close(); } catch { /* zu */ } this.senders.delete(ip); }
    const waits: Promise<void>[] = [];
    for (const ip of now) {
      if (!this.joined.has(ip)) { try { s.addMembership(SUITE_GROUP, ip); this.joined.add(ip); } catch { /* kein Multicast hier */ } }
      if (!this.senders.has(ip)) {
        const sock = dgram.createSocket({ type: "udp4" });
        const x = { sock, ready: false };
        this.senders.set(ip, x);
        sock.on("error", () => { try { sock.close(); } catch { /* zu */ } if (this.senders.get(ip) === x) this.senders.delete(ip); });
        waits.push(new Promise(res => {
          sock.bind(0, ip, () => {
            try { sock.setMulticastTTL(1); sock.setMulticastLoopback(true); sock.setMulticastInterface(ip); x.ready = true; } catch { /* nicht nutzbar */ }
            res();
          });
          setTimeout(res, 1000).unref();
        }));
      }
    }
    await Promise.all(waits);
  }

  private sendNow(obj: Record<string, unknown>, force = false): void {
    if (!this.recv) return;
    const data = Buffer.from(JSON.stringify(obj), "utf8");
    if (data.length > MAX_DATAGRAM) return;
    for (const x of this.senders.values()) {
      if (!x.ready || !this.gate.take(force)) continue;
      x.sock.send(data, this.port, SUITE_GROUP, () => { this.gate.done(); });
    }
  }
}
