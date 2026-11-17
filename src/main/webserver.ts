// Weboberfläche auf Port 8070 – ab Werk AUS, an nur über „Handys verbinden“ (RECHERCHE §4).
// node:http + ws. Nur Quelladressen aus RFC 1918, Link-Local und Loopback; Host- und Origin-Prüfung gegen
// DNS-Rebinding; statische Dateien nur aus einer festen Tabelle im Speicher (nie ein Pfad aus der URL); CSP ohne
// Fremdquellen; nur GET/HEAD. Port belegt → klare Meldung, kein Ausweich-Port (gedruckte QR-Codes zeigen 8070).
// Änderungen kommen in Phase 1 nicht über das Netz: alle Seiten sind nur lesend.
import http from "node:http";
import { execFile } from "node:child_process";
import { existsSync, promises as fsp } from "node:fs";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { MAX_URL, MAX_WS_CLIENTS, MAX_WS_PAYLOAD, hostAllowed, isLocalSource, originAllowed, route, webCsp } from "../core/net";
import type { Viewer, WebPlan } from "../core/plan";
import { ROLES, type Role } from "../core/model";

interface Asset { type: string; body: Buffer }
/** Feste Tabelle: veröffentlichter Pfad → Datei in dist/web. */
const FILES: Record<string, [string, string]> = {
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/assets/web.js": ["web.js", "text/javascript; charset=utf-8"],
  "/assets/style.css": ["style.css", "text/css; charset=utf-8"],
  "/assets/keep-awake-video.js": ["keep-awake-video.js", "text/javascript; charset=utf-8"],
  "/assets/fonts/InterDisplay-ExtraBold.ttf": ["fonts/InterDisplay-ExtraBold.ttf", "font/ttf"],
  "/assets/logo-horizontal-on-dark.svg": ["logo-horizontal-on-dark.svg", "image/svg+xml"],
  "/assets/logo-horizontal-on-light.svg": ["logo-horizontal-on-light.svg", "image/svg+xml"],
  "/assets/symbol.svg": ["symbol.svg", "image/svg+xml"],
  "/assets/icon.svg": ["icon.svg", "image/svg+xml"],
  "/assets/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json"],
};

export interface WebStatus { on: boolean; port: number; error?: string; /** Programm, das den Port belegt (wenn erkennbar) */ holder?: string; clients: number; byViewer: Partial<Record<Viewer, number>> }

interface Client { ws: WebSocket; viewer: Viewer | null; floor?: string; alive: boolean; pings: number[] }

/** Zeitabgleich: höchstens so viele `ping` je Verbindung in 10 s (8 beim Verbinden + Wiederholungen); mehr wird verworfen. */
export const MAX_PINGS = 20;

export class WebServer {
  private server?: http.Server;
  private wss?: WebSocketServer;
  private readonly assets = new Map<string, Asset>();
  private readonly clients = new Set<Client>();
  private pingTimer?: NodeJS.Timeout;
  private tickTimer?: NodeJS.Timeout;
  private port = 8070;
  error?: string;
  holder?: string;

  constructor(private readonly o: {
    dir: string;
    plan: (viewer: Viewer) => WebPlan | null;
    house: () => number;
    tick: () => Record<string, unknown>;
    changed: () => void;
  }) {}

  get on(): boolean { return !!this.server?.listening; }

  status(): WebStatus {
    const byViewer: Partial<Record<Viewer, number>> = {};
    for (const c of this.clients) if (c.viewer) byViewer[c.viewer] = (byViewer[c.viewer] ?? 0) + 1;
    return { on: this.on, port: this.port, clients: this.clients.size, byViewer, ...(this.error ? { error: this.error } : {}), ...(this.holder ? { holder: this.holder } : {}) };
  }

  private async loadAssets(): Promise<void> {
    if (this.assets.size) return;
    for (const [pub, [file, type]] of Object.entries(FILES)) {
      try { this.assets.set(pub, { type, body: await fsp.readFile(path.join(this.o.dir, file)) }); } catch { /* fehlt im Bau */ }
    }
  }

  /** Einschalten. Ergebnis: ok oder Fehlercode (EADDRINUSE, EACCES …). */
  async start(port: number): Promise<{ ok: boolean; error?: string }> {
    if (this.server) await this.stop();
    await this.loadAssets();
    this.port = port;
    this.error = undefined;
    const server = http.createServer((req, res) => this.request(req, res));
    server.headersTimeout = 10_000;
    server.requestTimeout = 30_000;
    server.maxHeadersCount = 50;
    server.on("connection", sock => { if (!isLocalSource(sock.remoteAddress)) sock.destroy(); });
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD });
    server.on("upgrade", (req, sock, head) => {
      const host = req.headers.host;
      if (!isLocalSource(req.socket.remoteAddress) || !hostAllowed(host, this.port) || !originAllowed(req.headers.origin, host)
        || (req.url ?? "").split("?")[0] !== "/ws" || this.clients.size >= MAX_WS_CLIENTS) {
        sock.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        sock.destroy();
        return;
      }
      wss.handleUpgrade(req, sock, head, ws => this.connect(ws));
    });
    const r = await new Promise<{ ok: boolean; error?: string }>(resolve => {
      server.once("error", (e: NodeJS.ErrnoException) => resolve({ ok: false, error: e.code ?? e.message }));
      server.listen(port, "0.0.0.0", () => resolve({ ok: true }));
    });
    this.holder = undefined;
    if (!r.ok) {
      this.error = r.error;
      try { server.close(); } catch { /* zu */ }
      if (r.error === "EADDRINUSE") this.holder = await portHolder(port);
      this.o.changed();
      return r;
    }
    this.server = server; this.wss = wss;
    // Lebenszeichen: iOS schließt tote Verbindungen nicht sauber
    this.pingTimer = setInterval(() => {
      for (const c of this.clients) { if (!c.alive) { c.ws.terminate(); continue; } c.alive = false; try { c.ws.ping(); } catch { /* weg */ } }
    }, 15_000);
    this.tickTimer = setInterval(() => this.broadcastTick(), 1000);
    this.o.changed();
    return r;
  }

  async stop(): Promise<void> {
    clearInterval(this.pingTimer); clearInterval(this.tickTimer);
    for (const c of this.clients) c.ws.terminate();
    this.clients.clear();
    this.wss?.close();
    const s = this.server;
    this.server = undefined; this.wss = undefined;
    if (s) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); }
    this.o.changed();
  }

  /** Neuer Plan: an alle verbundenen Seiten (je Ansicht gefiltert). */
  broadcastPlan(): void {
    for (const c of this.clients) if (c.viewer) this.sendPlan(c);
  }

  private broadcastTick(): void {
    const tick = JSON.stringify({ ...this.o.tick(), t: "tick", now: this.o.house() });
    for (const c of this.clients) if (c.viewer) { try { c.ws.send(tick); } catch { /* weg */ } }
  }

  private sendPlan(c: Client): void {
    if (!c.viewer) return;
    const plan = this.o.plan(c.viewer);
    try { c.ws.send(JSON.stringify({ t: "plan", plan })); } catch { /* weg */ }
  }

  private connect(ws: WebSocket): void {
    const c: Client = { ws, viewer: null, alive: true, pings: [] };
    this.clients.add(c);
    ws.on("pong", () => { c.alive = true; });
    ws.on("message", (data, isBinary) => {
      const r = this.o.house(); // Empfangszeit zuerst
      c.alive = true;
      if (isBinary) return;
      let m: Record<string, unknown>;
      try { const v: unknown = JSON.parse(String(data)); if (!v || typeof v !== "object" || Array.isArray(v)) return; m = v as Record<string, unknown>; } catch { return; }
      if (m.t === "ping" && typeof m.id === "number" && typeof m.c === "number" && Number.isFinite(m.c)) {
        const t0 = Date.now();
        while (c.pings.length && t0 - c.pings[0]! > 10_000) c.pings.shift();
        if (c.pings.length >= MAX_PINGS) return;
        c.pings.push(t0);
        try { ws.send(JSON.stringify({ t: "pong", id: m.id, c: m.c, r, s: this.o.house() })); } catch { /* weg */ }
        return;
      }
      if (m.t === "hello") {
        const v = m.view;
        const viewer: Viewer | null = v === "public" || v === "clock" ? v : ROLES.includes(v as Role) ? (v as Role) : null;
        if (!viewer) return;
        c.viewer = viewer;
        if (typeof m.floor === "string" && /^[a-z0-9_-]{1,40}$/i.test(m.floor)) c.floor = m.floor;
        this.sendPlan(c);
        this.o.changed();
      }
      // Phase 1: keine Änderungen über das Netz.
    });
    ws.on("close", () => { this.clients.delete(c); this.o.changed(); });
    ws.on("error", () => { /* close folgt */ });
    this.o.changed();
  }

  private request(req: http.IncomingMessage, res: http.ServerResponse): void {
    const host = req.headers.host;
    const send = (code: number, body = "", type = "text/plain; charset=utf-8", extra: Record<string, string> = {}) => {
      res.writeHead(code, { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store", ...extra });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    if (req.method !== "GET" && req.method !== "HEAD") return send(405, "Method Not Allowed", undefined, { Allow: "GET, HEAD" });
    if ((req.url ?? "").length > MAX_URL) return send(414, "URI Too Long");
    if (!hostAllowed(host, this.port)) return send(421, "Misdirected Request");
    let pathname: string;
    try { pathname = new URL(req.url ?? "/", "http://x").pathname; } catch { return send(400, "Bad Request"); }
    const r = route(pathname);
    if (!r) return send(404, "Not Found");
    const csp = webCsp(host!);
    if (r.page === "asset") {
      const a = this.assets.get(r.path);
      if (!a) return send(404, "Not Found");
      res.writeHead(200, { "Content-Type": a.type, "Content-Length": a.body.length, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-cache", "Content-Security-Policy": csp });
      res.end(req.method === "HEAD" ? undefined : a.body);
      return;
    }
    if (r.page === "chat") return send(404, "Not Found"); // Crew-Chat-Seite: Phase 2
    const page = this.assets.get("/index.html");
    if (!page) return send(500, "Build fehlt");
    res.writeHead(200, { "Content-Type": page.type, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store", "Content-Security-Policy": csp, "X-Frame-Options": "DENY" });
    res.end(req.method === "HEAD" ? undefined : page.body);
  }
}

/**
 * Welches Programm belegt den Port? Nur macOS/Linux über `lsof` (ohne Shell, 1,5 s Zeitlimit); sonst unbekannt.
 * Nur für die Meldung „Port 8070 ist belegt (…)“.
 */
export function portHolder(port: number): Promise<string | undefined> {
  if (process.platform === "win32" || !Number.isInteger(port)) return Promise.resolve(undefined);
  // fester Pfad, nie über PATH suchen
  const bin = ["/usr/sbin/lsof", "/usr/bin/lsof"].find(p => existsSync(p));
  if (!bin) return Promise.resolve(undefined);
  return new Promise(res => {
    execFile(bin, ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fc"], { timeout: 1500 }, (err, out) => {
      if (err && !out) return res(undefined);
      const name = String(out).split("\n").find(l => l.startsWith("c"))?.slice(1).trim();
      res(name ? name.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 40) : undefined);
    });
  });
}
