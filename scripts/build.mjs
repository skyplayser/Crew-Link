// Bau wie VJ-Link (scripts/build.mjs): esbuild für Main, Preload, Leitstand (Chromium) und Browser-Seiten
// (iOS 15 / Android 9: target chrome90, safari15, firefox90), statische Dateien kopieren, Lizenzen sammeln.
import { build } from "esbuild";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
for (const d of ["dist/main", "dist/renderer/intro", "dist/web/fonts", "dist/assets/fonts"]) await mkdir(d, { recursive: true });

const pkg = JSON.parse(await readFile("package.json", "utf8"));
// Source-Maps als eigene Dateien ohne Verweis im JS (QA 41): das Paket lässt *.map weg, also keine toten Verweise.
const common = { bundle: true, sourcemap: "external", logLevel: "warning", define: { APP_VERSION: JSON.stringify(pkg.version) } };

await build({ ...common, entryPoints: ["src/main/main.ts"], outfile: "dist/main/main.js", platform: "node", format: "cjs", target: "node22", external: ["electron"] });
await build({ ...common, entryPoints: ["src/main/preload.ts"], outfile: "dist/main/preload.js", platform: "node", format: "cjs", target: "node22", external: ["electron"] });
await build({ ...common, entryPoints: { app: "src/renderer/app.ts", clock: "src/renderer/clock.ts" }, outdir: "dist/renderer", platform: "browser", format: "iife", target: "chrome120" });
await build({ ...common, sourcemap: false, entryPoints: ["src/web/web.ts"], outfile: "dist/web/web.js", platform: "browser", format: "iife", target: ["chrome90", "safari15", "firefox90"] });

// Stile: Tokens + Komponenten aus design/ (gemeinsam für Leitstand und Browser) + Ergänzungen
const css = (await Promise.all(["tokens.css", "components.css", "app.css"].map(f => readFile(`src/shared/style/${f}`, "utf8")))).join("\n");
await writeFile("dist/renderer/style.css", css);
// Browser-Seiten liegen unter /assets/: Schrift-Pfad ../assets/fonts/ passt dort ebenso (→ /assets/fonts/)
await writeFile("dist/web/style.css", css);

for (const f of ["index.html", "clock.html"]) await cp(`src/renderer/${f}`, `dist/renderer/${f}`);
// Programm-Intro (gemeinsamer Baustein der Suite, Suite-Launcher design/intro-programm/): JS wird mitgebündelt,
// CSS und Bilder liegen daneben
await cp("src/renderer/intro/program-intro.css", "dist/renderer/intro/program-intro.css");
await cp("src/renderer/intro/icons", "dist/renderer/intro/icons", { recursive: true });
// Karte „Link-Suite laden“ (Suite-Launcher design/launcher-hinweis/): JS mitgebündelt, CSS und Icon daneben
await mkdir("dist/renderer/suite", { recursive: true });
await cp("src/renderer/suite/launcher-hint.css", "dist/renderer/suite/launcher-hint.css");
await cp("src/renderer/suite/icons", "dist/renderer/suite/icons", { recursive: true });
for (const f of ["index.html", "keep-awake-video.js", "manifest.webmanifest"]) await cp(`src/web/${f}`, `dist/web/${f}`);
for (const f of ["logo-horizontal-on-dark.svg", "logo-horizontal-on-light.svg", "symbol.svg", "icon.svg"]) {
  await cp(`assets/${f}`, `dist/assets/${f}`);
  await cp(`assets/${f}`, `dist/web/${f}`);
}
for (const f of ["InterDisplay-ExtraBold.ttf", "Inter-OFL.txt"]) {
  await cp(`assets/fonts/${f}`, `dist/assets/fonts/${f}`);
  await cp(`assets/fonts/${f}`, `dist/web/fonts/${f}`);
}
// Programm-Symbol (Fenster, Dock): assets/icon.png (1024 px, aus assets/icon.svg gerendert). Release-Bau: build/icon.icns, build/icon.ico (npm run icons).
await cp("assets/icon.png", "dist/icon.png");

// Lizenzen wie VJ-Link: alle Laufzeit-Pakete aus package-lock.json mit Lizenztext; fehlt einer, bricht der Bau ab.
{
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  const sep = "\n" + "=".repeat(100) + "\n";
  const parts = [`Crew Link ${pkg.version} – Licenses and third-party notices

Crew Link: Copyright (c) 2026 Philipp Spruck / NEXTPHILM. Licensed under the Eclipse Public License 2.0 (text below).
Source code: https://github.com/skyplayser/Crew-Link
Parts taken from VJ-Link (suite chat, lock, build), LJ Link (keep-awake video and logic) and the Link-Suite launcher
(intro, launcher hint, build scripts), same author, EPL-2.0.

Electron and Chromium: see LICENSE.electron.txt and LICENSES.chromium.html next to this file
(macOS: Crew Link.app/Contents/Resources; Windows: the "resources" folder inside the program folder).`];
  parts.push("Crew Link – Eclipse Public License 2.0\n\n" + (await readFile("LICENSE", "utf8")));
  const missing = [];
  for (const [key, info] of Object.entries(lock.packages)) {
    if (!key || info.dev) continue;
    const name = key.replace(/^.*node_modules\//, "");
    let text = null;
    try { const f = (await readdir(key)).find(x => /^(licen[cs]e|copying)(\.|$)/i.test(x)); if (f) text = await readFile(`${key}/${f}`, "utf8"); } catch { /* fehlt */ }
    if (!text) { missing.push(name); continue; }
    parts.push(`${name} ${info.version} (${info.license})\n\n${text.trim()}`);
  }
  if (missing.length) throw new Error(`Lizenztext fehlt für: ${missing.join(", ")}`);
  parts.push(`Digits: Inter Display ExtraBold (https://github.com/rsms/inter), SIL Open Font License 1.1.\n\n${(await readFile("assets/fonts/Inter-OFL.txt", "utf8")).trim()}`);
  // Electron bringt auf macOS drei Frameworks mit, die LICENSES.chromium.html nicht abdeckt (Rechtsprüfung N1).
  // Texte aus den Original-Repos, abgelegt in assets/licenses/ (17.11.2026).
  for (const [name, url, file] of [
    ["Squirrel.Mac", "https://github.com/Squirrel/Squirrel.Mac", "Squirrel.Mac-LICENSE.txt"],
    ["Mantle", "https://github.com/Mantle/Mantle", "Mantle-LICENSE.txt"],
    ["ReactiveObjC", "https://github.com/ReactiveCocoa/ReactiveObjC", "ReactiveObjC-LICENSE.txt"],
  ]) parts.push(`${name} (${url}), MIT – part of Electron on macOS (Crew Link.app/Contents/Frameworks)\n\n${(await readFile(`assets/licenses/${file}`, "utf8")).trim()}`);
  await writeFile("dist/THIRD_PARTY_LICENSES.txt", parts.join(sep) + "\n");
}
console.log(`Crew Link ${pkg.version} gebaut (dist/).`);
