// Netz mit echten Sockets – Suite-Netz nur auf dem Testport 47681 (nie 47676), Webserver auf einem freien Port.
import { describe, expect, it } from "vitest";
import http from "node:http";
import net from "node:net";
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { SuiteNet, TEST_PORT, adapters, ifaceFor } from "../src/main/suitenet";
import { WebServer } from "../src/main/webserver";
import { Storage } from "../src/main/storage";
import { makeDemo } from "../src/core/demo";
import { planFor } from "../src/core/plan";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const hasNet = adapters().length > 0;
// Echter Multicast über die Netzadapter. Auf GitHub-Windows-Runnern (VM-Netz, Windows-Firewall für neue Programme) kommt
// eigener Multicast nicht verlässlich zurück – dort übersprungen; derselbe Code läuft auf macOS im Workflow und lokal.
// Unter Windows von Hand prüfen (Suite-Chat mit einem zweiten Suite-Programm).
const realMulticast = hasNet && !(process.platform === "win32" && !!process.env.CI);

describe("Suite-Netz (Testport 47681)", () => {
  it("Testport ist nicht der echte Suite-Port", () => { expect(TEST_PORT).toBe(47681); });
  it("Adapter für ein Datagramm finden", () => {
    const list = [{ address: "192.168.1.20", netmask: "255.255.255.0" }, { address: "10.0.0.5", netmask: "255.0.0.0" }];
    expect(ifaceFor("10.1.2.3", list)).toBe("10.0.0.5");
    expect(ifaceFor("192.168.1.99", list)).toBe("192.168.1.20");
  });
  it.skipIf(!realMulticast)("zwei Teilnehmer: send/on mit from.address und from.iface; probe → echo je Adapter", async () => {
    const a = new SuiteNet({ port: TEST_PORT, app: "Crew Link", ver: "0.1.0" });
    const b = new SuiteNet({ port: TEST_PORT, app: "Test", ver: "1", answerProbes: false });
    await a.start(); await b.start();
    expect(a.listening && b.listening).toBe(true);
    const got: { msg: Record<string, unknown>; from: { address: string; iface: string } }[] = [];
    b.on("crew", (msg, from) => got.push({ msg: msg as Record<string, unknown>, from }));
    const echoes: Record<string, unknown>[] = [];
    b.on("net", m => { const o = m as Record<string, unknown>; if (o.t === "echo") echoes.push(o); });
    await sleep(300);
    expect(a.send("crew", { t: "tick", now: 1 })).toBe(true);
    expect(a.send("crew", { t: "x", big: "y".repeat(9000) })).toBe(false); // > 8 KB
    b.send("net", { t: "probe", app: "NET Link", ver: "0.1", seq: 7, at: 1 });
    b.send("net", { t: "probe", app: "NET Link", ver: "0.1", seq: 8, at: 1 }); // gleich danach: höchstens 1/s je peer
    await sleep(800);
    expect(got.some(g => g.msg.t === "tick" && g.msg.suite === "crew" && g.msg.peer === a.peer && g.msg.v === 1)).toBe(true);
    expect(got[0]!.from.iface).toBeTruthy();
    expect(echoes.length).toBeGreaterThanOrEqual(1);
    expect(echoes[0]).toMatchObject({ suite: "net", t: "echo", peer: a.peer, app: "Crew Link", ver: "0.1.0", to: b.peer, seq: 7 });
    expect(adapters().map(x => x.address)).toContain(echoes[0]!.ip);
    expect(echoes.filter(e => e.seq === 8)).toHaveLength(0);
    expect(new Set(echoes.map(e => e.ip)).size).toBeLessThanOrEqual(adapters().length); // eine Antwort je Adapter (Empfang kann doppelt sein)
    a.stop(); b.stop();
    await sleep(200);
  });
});

function freePort(): Promise<number> {
  return new Promise(res => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });
}
function get(port: number, path: string, host: string, method = "GET"): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((res, rej) => {
    const r = http.request({ host: "127.0.0.1", port, path, method, headers: { Host: host } }, resp => { let b = ""; resp.on("data", d => (b += d)); resp.on("end", () => res({ status: resp.statusCode!, headers: resp.headers, body: b })); });
    r.on("error", rej); r.end();
  });
}

describe("Webserver", () => {
  it("ab Werk aus; an: Seiten, CSP, Host-Prüfung, nur GET, WebSocket mit Origin, Plan und Zeitabgleich, Port belegt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "crewweb-"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>x</title>");
    writeFileSync(join(dir, "web.js"), "1");
    const now = Date.parse("2026-11-15T01:46:48Z");
    const ev = makeDemo(now);
    let house = now;
    const web = new WebServer({ dir, plan: v => planFor(ev, v, { rev: 1, privacy: false }), house: () => house++, tick: () => ({ rev: 1 }), changed: () => {} });
    expect(web.on).toBe(false);
    const port = await freePort();
    expect(await web.start(port)).toEqual({ ok: true });
    const host = `127.0.0.1:${port}`;
    const page = await get(port, "/r/bar", host);
    expect(page.status).toBe(200);
    expect(page.headers["content-security-policy"]).toContain(`connect-src 'self' ws://${host}`);
    expect(page.headers["x-content-type-options"]).toBe("nosniff");
    expect(page.headers["cache-control"]).toBe("no-store");
    expect((await get(port, "/assets/web.js", host)).body).toBe("1");
    expect((await get(port, "/assets/../main.js", host)).status).toBe(404);
    expect((await get(port, "/r/admin", host)).status).toBe(404);
    expect((await get(port, "/", `evil.example:${port}`)).status).toBe(421);
    expect((await get(port, "/", host, "POST")).status).toBe(405);
    // WebSocket: falscher Origin wird abgelehnt
    const bad = new WebSocket(`ws://${host}/ws`, { headers: { Origin: "http://evil.example" } });
    const badErr = await new Promise(r => { bad.on("error", () => r("err")); bad.on("open", () => r("open")); });
    expect(badErr).toBe("err");
    const ws = new WebSocket(`ws://${host}/ws`, { headers: { Origin: `http://${host}` } });
    const msgs: Record<string, unknown>[] = [];
    ws.on("message", d => msgs.push(JSON.parse(String(d))));
    await new Promise(r => ws.on("open", r));
    ws.send(JSON.stringify({ t: "hello", view: "public" }));
    ws.send(JSON.stringify({ t: "ping", id: 1, c: 123.5 }));
    await sleep(300);
    const plan = msgs.find(m => m.t === "plan")!.plan as { slots: { name: string; note: string }[] };
    expect(JSON.stringify(plan)).not.toContain("Mara Lux");
    expect(plan.slots.every(s => s.note === "")).toBe(true);
    const pong = msgs.find(m => m.t === "pong")!;
    expect(pong).toMatchObject({ id: 1, c: 123.5 });
    expect(pong.s as number).toBeGreaterThanOrEqual(pong.r as number);
    expect(web.status().byViewer.public).toBe(1);
    // höchstens 20 Pings in 10 s je Verbindung (QA Runde 1, Nr. 13)
    for (let i = 0; i < 40; i++) ws.send(JSON.stringify({ t: "ping", id: 100 + i, c: i }));
    await sleep(300);
    expect(msgs.filter(m => m.t === "pong").length).toBe(20);
    // Port belegt: klare Meldung, kein Ausweich-Port
    const other = new WebServer({ dir, plan: () => null, house: () => 0, tick: () => ({}), changed: () => {} });
    expect(await other.start(port)).toEqual({ ok: false, error: "EADDRINUSE" });
    // Programmname, wenn erkennbar (lsof mit 1,5 s Zeitlimit – unter Last evtl. leer, dann Meldung ohne Namen)
    const holder = other.status().holder;
    if (holder !== undefined) expect(holder).toMatch(/node|electron/i);
    ws.close();
    await web.stop();
    expect(web.on).toBe(false);
  });
});

describe("Speichern nur mit Zustimmung", () => {
  it("ohne Zustimmung und in der Demo: nichts auf der Platte; mit Zustimmung: Datei + Verweis", async () => {
    const dir = mkdtempSync(join(tmpdir(), "crewdata-"));
    const st = new Storage(dir);
    await st.init("de");
    const ev = makeDemo(Date.now());
    st.autosave(ev, null, () => {});
    expect(await st.flush()).toBeNull();
    const noConsent = { ...ev, demo: undefined, consent: { save: false, log: false, at: 1 } };
    st.autosave(noConsent, null, () => {});
    expect(await st.flush()).toBeNull();
    await st.savePrefs();
    expect(readdirSync(dir)).toEqual([]);
    const yes = { ...noConsent, consent: { save: true, log: false, at: 1 } };
    st.autosave(yes, null, () => {});
    const file = await st.flush();
    expect(file && existsSync(file)).toBe(true);
    expect(file).toContain(yes.id);
    expect(file).not.toContain("Wochenende");
    const st2 = new Storage(dir);
    await st2.init("de");
    expect((await st2.loadLast())?.ev.id).toBe(yes.id);
  });
});

import { readSuiteIntro, RunLock } from "../src/main/storage";
describe("Startanimation: suite.json und Absturz-Merker", () => {
  it("suite.json wird nur gelesen; fehlt oder kaputt → true", async () => {
    const dir = mkdtempSync(join(tmpdir(), "crewsuite-"));
    expect(await readSuiteIntro(dir)).toBe(true);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(dir, "Link-Suite"));
    writeFileSync(join(dir, "Link-Suite", "suite.json"), "kaputt");
    expect(await readSuiteIntro(dir)).toBe(true);
    writeFileSync(join(dir, "Link-Suite", "suite.json"), JSON.stringify({ intro: false }));
    expect(await readSuiteIntro(dir)).toBe(false);
  });
  it("running.lock: zweiter Start ohne sauberes Beenden gilt als Absturz", async () => {
    const dir = mkdtempSync(join(tmpdir(), "crewlock-"));
    const a = new RunLock(dir); await a.acquire();
    expect(a.crashed).toBe(false);
    const b = new RunLock(dir); await b.acquire();
    expect(b.crashed).toBe(true);
    b.release();
    const c = new RunLock(dir); await c.acquire();
    expect(c.crashed).toBe(false);
    c.release();
    expect(readdirSync(dir)).toEqual([]);
  });
});
