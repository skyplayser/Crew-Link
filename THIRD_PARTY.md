# Fremdbestandteile von Crew Link

Crew Link steht unter der **Eclipse Public License 2.0** (`LICENSE`). Beim Bau (`npm run build`) sammelt
`scripts/build.mjs` die Lizenztexte aller Laufzeit-Pakete aus `package-lock.json` in `dist/THIRD_PARTY_LICENSES.txt`
und bricht ab, wenn einer fehlt (wie VJ-Link). Im Release-Paket liegt sie mit `LICENSE.txt`, `LICENSE.electron.txt` und
`LICENSES.chromium.html` im Ordner `resources` (macOS: `Crew Link.app/Contents/Resources`). Quellcode:
https://github.com/skyplayser/Crew-Link (auch im Über-Fenster).

## Laufzeit

| Name | Version | Lizenz | Wofür | Geprüft in |
|---|---|---|---|---|
| Electron (mit Chromium, Node) | 45.3.1 | MIT (+ Chromium-Lizenzen, `LICENSES.chromium.html`) | Rahmen | Recherche (intern) §9 |
| Squirrel.Mac, Mantle, ReactiveObjC (mit Electron, nur macOS) | wie Electron 45.3.1 | MIT (Texte in `assets/licenses/`, im Paket in `THIRD_PARTY_LICENSES.txt`) | Frameworks in `Crew Link.app/Contents/Frameworks`, von Electron mitgebracht | Rechtsprüfung N1 |
| ws | 8.23.0 | MIT | WebSocket-Server der Weboberfläche | Recherche (intern) §4 |
| uqr | 0.1.3 | MIT (© Project Nayuki, © 2023 Anthony Fu) | QR-Codes je Rolle, offline | Recherche (intern) §6 |
| Inter Display ExtraBold | – | SIL Open Font License 1.1 (`assets/fonts/Inter-OFL.txt`) | große Ziffern („Crew Display“) | Design (intern), „Schrift-Entscheidung“ |

## Nur zum Entwickeln (nicht im Programm)

| Name | Version | Lizenz | Wofür |
|---|---|---|---|
| temporal-polyfill | 1.0.8 | MIT | Gegenprüfung von `src/core/zeit.ts` in den Tests |
| TypeScript | 5.x | Apache-2.0 | Typprüfung |
| esbuild | 0.28.x | MIT | Bau |
| electron-builder | 26.17.0 | MIT | Release-Bau (DMG, NSIS-Installer); baut das Paket, wird selbst nicht ausgeliefert |
| vitest | 5.1.x | MIT | Tests |
| @types/node, @types/ws | – | MIT | Typen |

## Übernommener Code der Suite (gleicher Autor, EPL-2.0)

| Datei in Crew Link | Herkunft |
|---|---|
| `src/core/suitechat.ts`, `tests/suitechat.test.ts` | VJ-Link `src/core/suitechat.ts`, `tests/suitechat.test.ts` (0.1.8) |
| `src/main/suitenet.ts`, `src/main/chatnet.ts` | Regeln und Sockets aus VJ-Link `src/main/suitechat.ts` (ChatNet) |
| `src/renderer/chat.ts`, `src/renderer/lock.ts` | VJ-Link `src/renderer/chat.ts`, `src/renderer/lock.ts` |
| `scripts/build.mjs` (Lizenz-Sammler) | VJ-Link `scripts/build.mjs` |
| `src/web/keep-awake-video.js` (unverändert), `src/web/awake.ts` | LJ Link `src/main/resources/web/keep-awake-video.js`, `app.js` (ADR-022) |
| `src/renderer/intro/program-intro.{js,d.ts,css}`, `src/renderer/intro/icons/` | Suite-Launcher `design/intro-programm/` (Baustein „Programm-Intro“ 1.0, 16.11.2026, unverändert) |
| `src/renderer/suite/launcher-hint.{js,d.ts,css}`, `src/renderer/suite/icons/` | Suite-Launcher `design/launcher-hinweis/` (Baustein „Hinweis Link-Suite laden“ 1.0, Stand im Suite-Launcher am 17.11.2026, unverändert) |
| `src/main/suite/launcher-detect{,.test}.ts` | ebenda, mit Abweichungen (QA Runde 4, Nr. 31/35): `reg.exe` über den festen Pfad `%SystemRoot%\System32\reg.exe`, Pfade je Zielsystem mit `path.posix`/`path.win32`; Test läuft über vitest statt `node --test`, ein Test mehr (reg.exe-Pfad) |
| `build/after-pack.cjs` | Suite-Launcher `build/after-pack.cjs` (ursprünglich VD-Link), unverändert bis auf den Kopfkommentar |
| `build/installer.nsh` | Suite-Launcher `build/installer.nsh`, Programmname angepasst |
| `scripts/rename-dist.mjs` | Suite-Launcher `scripts/rename-dist.mjs`, Dateinamen angepasst |
| `.github/workflows/release.yml` | Suite-Launcher `.github/workflows/release.yml`, Namen angepasst, Release als Vorabversion |
| `src/shared/style/tokens.css`, `components.css`, `src/shared/icons.ts` | `design/` (Design 0.1), Icons aus `design/muster.js` |
