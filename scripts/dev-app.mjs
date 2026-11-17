// Crew Link starten (npm start). Startoptionen werden durchgereicht, z. B. `npm start -- --demo`.
// Fehlt das Electron-Programm (neuere Electron-Pakete laden es erst bei Bedarf), wird es einmal geholt.
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let bin;
try { bin = require("electron"); } catch { bin = ""; }
if (!bin || !existsSync(bin)) {
  console.log("Electron wird einmalig geladen …");
  execFileSync(process.execPath, [join(root, "node_modules", "electron", "install.js")], { stdio: "inherit" });
  bin = require("electron");
}
const args = process.argv.slice(2).filter(a => a !== "--run");
const child = spawn(bin, [root, ...args], { stdio: "inherit" });
child.on("exit", code => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
