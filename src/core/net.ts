// Prüfungen für den Webserver (RECHERCHE §4), ohne Sockets: Quelladresse, Host-Kopf, Origin, Pfade.
// Und das Suite-Protokoll `suite: "crew"` (suite-net spec/suite-crew.md): here, tick, bye bauen.
import { cleanText } from "./suitechat";
import { curfewPhase, floorStatus, shownDay, dayView } from "./countdown";
import { publicName, ROLE_PATH, ROLES, type CrewEvent, type Role } from "./model";
import { dayShort } from "./zeit";

export const WEB_PORT = 8070;
export const MAX_WS_PAYLOAD = 64 * 1024;
export const MAX_WS_CLIENTS = 100;
export const MAX_URL = 2048;

/** IPv4 als Zahl, oder null. Nimmt auch „::ffff:a.b.c.d“. */
export function ipv4(addr: string | undefined): number | null {
  if (!addr) return null;
  const a = addr.startsWith("::ffff:") ? addr.slice(7) : addr;
  const r = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (!r) return null;
  const p = r.slice(1).map(Number);
  if (p.some(x => x > 255)) return null;
  return ((p[0]! << 24) >>> 0) + (p[1]! << 16) + (p[2]! << 8) + p[3]!;
}

/** Erlaubt: 10/8, 172.16/12, 192.168/16, 169.254/16, 127/8. Nicht 100.64/10 (CGNAT, Tailscale). */
export function isLocalSource(addr: string | undefined): boolean {
  const n = ipv4(addr);
  if (n === null) return addr === "::1";
  const a = n >>> 24, b = (n >>> 16) & 255;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** Host-Kopf: nur IP-Literal, „localhost“ oder „*.local“, mit dem eigenen Port (Schutz gegen DNS-Rebinding). */
export function hostAllowed(host: string | undefined, port: number): boolean {
  if (!host || host.length > 255) return false;
  const r = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/i.exec(host);
  if (!r) return false;
  const name = r[1]!.toLowerCase(), p = r[2] ? Number(r[2]) : 80;
  if (p !== port) return false;
  return ipv4(name) !== null || name === "localhost" || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.local$/.test(name);
}

/** WebSocket-Origin muss genau http://<Host> sein. */
export function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  return !!origin && !!host && origin === `http://${host}`;
}

export type Route =
  | { page: "choose" }
  | { page: "role"; role: Role; sub?: string }
  | { page: "clock"; floor: string }
  | { page: "public"; floor?: string }
  | { page: "asset"; path: string }
  | { page: "chat" };

/** Pfad der Seite deuten. Rolle und Floor nur als Kennung (Prüfung gegen den Plan macht die Seite). */
export function route(pathname: string): Route | null {
  let p: string;
  try { p = decodeURIComponent(pathname); } catch { return null; }
  if (p.includes("\0") || p.includes("\\") || p.includes("..")) return null;
  if (p === "/" || p === "") return { page: "choose" };
  if (p === "/oeffentlich" || p === "/oeffentlich/") return { page: "public" };
  if (p === "/chat") return { page: "chat" };
  let m = /^\/r\/([a-z]+)(?:\/([a-z0-9_-]{1,40}))?\/?$/i.exec(p);
  if (m) {
    const role = ROLES.find(r => ROLE_PATH[r] === m![1]!.toLowerCase());
    return role ? { page: "role", role, ...(m[2] ? { sub: m[2] } : {}) } : null;
  }
  m = /^\/uhr\/([a-z0-9_-]{1,40})\/?$/i.exec(p);
  if (m) return { page: "clock", floor: m[1]! };
  if (/^\/assets\/[a-z0-9._-]+(\/[a-z0-9._-]+)?$/i.test(p)) return { page: "asset", path: p };
  return null;
}

/** Content-Security-Policy der Browser-Seiten; ws:// aus dem geprüften Host (Safari < 16 deckt ws: mit 'self' nicht ab). */
export function webCsp(host: string): string {
  return `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; media-src data:; connect-src 'self' ws://${host}; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
}

// ------------------------------------------------------------------ suite: "crew"

export const CREW_HERE_EVERY_MS = 5000;
export const FLOOR_COLORS = ["#22C8F0", "#B45CFF", "#3DDC84", "#FFB020", "#FF3B3B"];

export interface CrewHere { t: "here"; app: string; ver: string; role: "lead" | "standby"; http: string; event: string; day: string; rev: number }
/** `here`: Start und alle 5 s. `http` leer, wenn die Weboberfläche aus ist. */
export function crewHere(ev: CrewEvent | null, o: { ver: string; http: string; rev: number; now: number }): CrewHere {
  const d = ev ? shownDay(ev, o.now) : undefined;
  return { t: "here", app: "Crew Link", ver: o.ver, role: "lead", http: o.http, event: ev?.id ?? "", day: d?.id ?? "", rev: o.rev };
}

/**
 * `tick` jede Sekunde: Hausuhr, laufender Tag, Sperrstunde, je Floor laufender und nächster Slot – NUR öffentliche
 * Namen, nur der laufende Tag (suite-crew.md). Interne Namen kommen nie in den Multicast.
 */
export function crewTick(ev: CrewEvent | null, o: { now: number; rev: number; src?: "system" | "timecode" | "free" }): Record<string, unknown> {
  const out: Record<string, unknown> = { t: "tick", now: Math.round(o.now), src: o.src ?? "system", rev: o.rev };
  if (!ev) return out;
  const v = dayView(ev, o.now);
  if (v.mode !== "running") return out;
  const day = v.day;
  out.day = { id: day.id, label: cleanText(day.label || dayShort(day.date, "de"), 24) };
  if (day.curfew !== null) out.curfew = { at: day.curfew, phase: curfewPhase(day.curfew, o.now, ev.signals) };
  out.floors = ev.floors.slice(0, 12).map(f => {
    const st = floorStatus(ev, day, f.id, o.now);
    const x: Record<string, unknown> = { id: f.id, name: cleanText(f.name, 24), color: FLOOR_COLORS[f.color % 5] };
    if (st.ownEnd) x.end = st.floorEnd;
    if (st.cur && (st.state === "live" || st.state === "over")) x.cur = { slot: st.cur.id, name: cleanText(publicName(st.cur), 48), start: st.cur.handover ?? st.cur.start, end: st.cur.end };
    if (st.next) x.next = { slot: st.next.id, name: cleanText(publicName(st.next), 48), start: st.next.start, ready: st.next.readyAt !== undefined };
    return x;
  });
  return out;
}

/** Höchstens so viele fremde Leitstände werden gemerkt (die stillsten fallen raus). */
export const MAX_LEADS = 8;
/** `here` je fremdem peer höchstens 1 je Sekunde, insgesamt höchstens 50 je Sekunde (Schutz gegen Fluten). */
export const LEAD_PEER_MS = 1000;
export const LEAD_TOTAL_PER_S = 50;

/**
 * Zwei Leitstände im Netz (Konzept „Wenn das Netz ausfällt“): fremde `here` mit `role:"lead"` merken. Es gilt, wer
 * zuerst da war: Wer erst mehr als 6 s nach unserem Start zum ersten Mal zu hören ist, kam nach uns (`here` kommt
 * alle 5 s). Nach 15 s ohne `here` ist der andere weg. Grenzen: höchstens 8 gemerkt, gedrosselt je peer und gesamt.
 */
export class LeadWatch {
  private readonly leads = new Map<string, { address: string; http: string; first: number; last: number }>();
  private windowStart = 0;
  private windowCount = 0;
  constructor(private readonly ownPeer: string, private readonly since: number) {}
  /** true, wenn ein neuer fremder Leitstand dazukam. */
  hear(m: unknown, address: string, now: number): boolean {
    if (!m || typeof m !== "object") return false;
    const o = m as Record<string, unknown>;
    if (o.suite !== "crew" || o.t !== "here" || o.role !== "lead" || typeof o.peer !== "string" || !/^[0-9a-z]{8,32}$/.test(o.peer) || o.peer === this.ownPeer) return false;
    if (now - this.windowStart >= 1000) { this.windowStart = now; this.windowCount = 0; }
    if (this.windowCount >= LEAD_TOTAL_PER_S) return false;
    const known = this.leads.get(o.peer);
    if (known && now - known.last < LEAD_PEER_MS) return false;
    this.windowCount++;
    const http = typeof o.http === "string" && /^[0-9.]{7,15}:\d{1,5}$/.test(o.http) ? o.http : "";
    if (!known && this.leads.size >= MAX_LEADS) {
      let stalest: string | undefined, t = Infinity;
      for (const [k, v] of this.leads) if (v.last < t) { t = v.last; stalest = k; }
      if (stalest) this.leads.delete(stalest);
    }
    this.leads.set(o.peer, { address, http, first: known?.first ?? now, last: now });
    return !known;
  }
  /** true, wenn einer verschwunden ist. */
  expire(now: number): boolean {
    let gone = false;
    for (const [k, v] of this.leads) if (now - v.last > 15_000) { this.leads.delete(k); gone = true; }
    return gone;
  }
  get size(): number { return this.leads.size; }
  list(): { address: string; http: string; weFirst: boolean }[] {
    return [...this.leads.values()].sort((a, b) => a.first - b.first).map(o => ({ address: o.address, http: o.http, weFirst: o.first - this.since > 6000 }));
  }
}
