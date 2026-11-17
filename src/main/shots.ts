// Screenshots für die QA: `--demo --web-on --shot <ordner>` (bzw. nur `--shot <ordner>`, das schaltet Demo und
// Weboberfläche selbst ein). Macht PNGs von Startbildschirm, TIMETABLE, JETZT, ROLLEN, VERBINDEN, großer Uhr und den
// Browser-Seiten (über http://127.0.0.1:<port>), je in Nacht/Tag und Deutsch/Englisch, und beendet sich dann.
import { BrowserWindow, app } from "electron";
import { promises as fsp } from "node:fs";
import path from "node:path";
import type { CrewEvent } from "../core/model";

interface Ctx {
  main: () => BrowserWindow | null;
  openClock: (floor: string) => BrowserWindow | null;
  event: () => CrewEvent | null;
  port: () => number;
  setLang: (l: "de" | "en") => void;
  /** Demo in dieser Sprache neu erzeugen (Inhalte wie Wochentage, Notizen, Rollen), Weboberfläche bleibt am selben Port */
  demo: (l: "de" | "en") => Promise<void>;
  /** --intro=<ms,…> (Alias --intro-at): nur die Bildfolge der Startanimation (ms) */
  introAt: number[];
  /** --launcher=installed|missing mit --hint: nur Startbildschirm mit/ohne Karte „Link-Suite laden“ */
  launcher: string | null;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function save(win: BrowserWindow, file: string): Promise<void> {
  const img = await win.webContents.capturePage();
  await fsp.writeFile(file, img.toPNG());
}

async function loaded(win: BrowserWindow): Promise<void> {
  if (!win.webContents.isLoading()) return;
  await new Promise<void>(r => win.webContents.once("did-finish-load", () => r()));
}

export async function runShots(dir: string, c: Ctx): Promise<void> {
  const out = path.resolve(dir);
  const done: string[] = [];
  try {
    await fsp.mkdir(out, { recursive: true });
    await sleep(800);
    const main = c.main();
    if (!main) throw new Error("kein Fenster");
    await loaded(main);
    await sleep(1800);
    const js = (code: string) => main.webContents.executeJavaScript(code, true);
    const shot = async (name: string) => { const f = path.join(out, `${name}.png`); await save(main, f); done.push(f); };
    const port = c.port();
    if (c.launcher) {
      // Karte „Link-Suite laden“: Startbildschirm Nacht DE, Tag DE, Nacht EN; bei „missing“ danach „Nicht mehr zeigen“
      for (const [theme, lang] of [["night", "de"], ["day", "de"], ["night", "en"]] as const) {
        await js(`crewShot.lang(${JSON.stringify(lang)}); crewShot.theme(${JSON.stringify(theme)}); crewShot.start(true);`);
        await sleep(1200);
        await shot(`launcher-${c.launcher}-${theme}-${lang}`);
      }
      if (c.launcher === "missing") {
        await js(`crewShot.lang("de"); crewShot.theme("night"); crewShot.start(true);`); await sleep(1200);
        await js(`document.querySelector(".lsh-hide")?.click()`); await sleep(700);
        await shot("launcher-nach-nicht-mehr-zeigen-night-de");
      }
      await fsp.writeFile(path.join(out, `LISTE-${c.launcher}.txt`), done.map(f => path.basename(f)).join("\n") + "\n");
      app.quit();
      return;
    }
    if (c.introAt.length) {
      // Bildfolge der Startanimation (Standbilder über holdAt des Bausteins), Nacht und Tag, dazu „Bewegung reduzieren“
      for (const theme of ["night", "day"] as const) {
        await js(`crewShot.theme(${JSON.stringify(theme)}); crewShot.start(true);`);
        await sleep(600);
        for (const ms of c.introAt) {
          await js(`crewShot.intro(${ms}, false)`); await sleep(700);
          await shot(`intro-${theme}-${String(ms).padStart(4, "0")}`);
        }
        await js("crewShot.intro(400, true)"); await sleep(700); await shot(`intro-${theme}-reduziert-0400`);
        await js("crewShot.introEnd()"); await sleep(300); await shot(`intro-${theme}-ende`);
        // Startbildschirm abgewählt: Landung im Kopf-Logo (Zeichen + Text, signTarget)
        for (const ms of c.introAt.filter(x => x >= 1500)) {
          await js(`crewShot.intro(${ms}, false, true)`); await sleep(700);
          await shot(`intro-kopf-${theme}-${String(ms).padStart(4, "0")}`);
        }
        await js("crewShot.introEnd()"); await sleep(300); await shot(`intro-kopf-${theme}-ende`);
        await js("crewShot.start(true)"); await sleep(300);
      }
      await fsp.writeFile(path.join(out, "LISTE.txt"), done.map(f => path.basename(f)).join("\n") + "\n");
      console.log(`Crew Link: ${done.length} Bilder der Startanimation in ${out}`);
      app.quit();
      return;
    }
    for (const lang of ["de", "en"] as const) {
      // Demo-Inhalte in der Sprache der Bilder (QA Runde 4, Nr. 33); Zeiten bleiben relativ zu jetzt
      c.setLang(lang);
      await c.demo(lang);
      await sleep(600);
      for (const theme of ["night", "day"] as const) {
        await js(`crewShot.lang(${JSON.stringify(lang)}); crewShot.theme(${JSON.stringify(theme)});`);
        c.setLang(lang);
        await sleep(500);
        await js("crewShot.start(true)"); await sleep(400); await shot(`leitstand-start-${lang}-${theme}`);
        await js("crewShot.tab('timetable'); crewShot.select('Nova')"); await sleep(500); await shot(`leitstand-timetable-${lang}-${theme}`);
        await js("crewShot.tab('now')"); await sleep(400); await shot(`leitstand-jetzt-${lang}-${theme}`);
        await js("crewShot.tab('roles')"); await sleep(600); await shot(`leitstand-rollen-${lang}-${theme}`);
        await js("crewShot.tab('connect')"); await sleep(300); await shot(`leitstand-verbinden-${lang}-${theme}`);
        // große Uhr (Fenster) – Main läuft, Keller überzogen
        for (const floor of ["main", "keller"]) {
          const w = c.openClock(floor);
          if (!w) continue;
          await loaded(w); await sleep(900);
          const f = path.join(out, `uhr-fenster-${floor}-${lang}-${theme}.png`);
          await save(w, f); done.push(f);
          w.destroy();
        }
        // Browser-Seiten
        const pages: [string, string, number, number][] = [
          ["web-rolle-waehlen", "/", 390, 844], ["web-leitung", "/r/leitung", 390, 844], ["web-booth-keller", "/r/booth/keller", 390, 844],
          ["web-dj-kira", "/r/dj/kira", 390, 844], ["web-technik", "/r/technik", 390, 844], ["web-security", "/r/security", 390, 844], ["web-bar", "/r/bar", 390, 844],
          ["web-uhr-main", "/uhr/main", 1280, 720], ["web-uhr-keller", "/uhr/keller", 1280, 720], ["web-oeffentlich", "/oeffentlich", 1280, 720],
        ];
        for (const [name, p, w, h] of pages) {
          const win = new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
          win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
          await win.loadURL(`http://127.0.0.1:${port}${p}?theme=${theme}&lang=${lang}`).catch(() => { /* Port aus? dann leer */ });
          await sleep(1300);
          const f = path.join(out, `${name}-${lang}-${theme}.png`);
          await save(win, f); done.push(f);
          win.destroy();
        }
      }
    }
    await fsp.writeFile(path.join(out, "LISTE.txt"), done.map(f => path.basename(f)).join("\n") + "\n");
    console.log(`Crew Link: ${done.length} Screenshots in ${out}`);
  } catch (e) {
    console.error("Screenshots fehlgeschlagen:", e);
    process.exitCode = 1;
  }
  app.quit();
}
