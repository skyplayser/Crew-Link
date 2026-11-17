// Übernommen aus Suite-Launcher scripts/rename-dist.mjs (EPL-2.0), Namen angepasst.
// electron-builder nennt Intel „x64“; die Suite nennt die Dateien „…-macos-intel.dmg“ (Regeln für Releases).
import fs from "node:fs";
import path from "node:path";

const dir = "release";
for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
  const m = /^Crew-Link-macos-x64\.(dmg|dmg\.blockmap)$/.exec(f);
  if (m) {
    fs.renameSync(path.join(dir, f), path.join(dir, `Crew-Link-macos-intel.${m[1]}`));
    console.log(`rename-dist: ${f} → Crew-Link-macos-intel.${m[1]}`);
  }
}
