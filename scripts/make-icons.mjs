// Programm-Symbole für den Release-Bau aus assets/icon.png (1024 px): build/icon.icns (macOS) und build/icon.ico (Windows).
// Nur macOS-Bordmittel (sips, iconutil), keine Abhängigkeiten. Die Ergebnisse liegen im Repo, damit der Windows-Bau im
// Workflow das Skript nicht braucht. Neu erzeugen nur, wenn sich assets/icon.png ändert: `npm run icons`.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.platform !== "darwin") throw new Error("make-icons: braucht macOS (sips, iconutil)");
const SRC = "assets/icon.png";
const tmp = mkdtempSync(join(tmpdir(), "crewlink-icons-"));
const resize = (px, out) => execFileSync("/usr/bin/sips", ["-z", String(px), String(px), SRC, "--out", out], { stdio: "ignore" });

try {
  // macOS: .iconset → iconutil
  const set = join(tmp, "icon.iconset");
  mkdirSync(set);
  for (const s of [16, 32, 128, 256, 512]) {
    resize(s, join(set, `icon_${s}x${s}.png`));
    resize(s * 2, join(set, `icon_${s}x${s}@2x.png`));
  }
  mkdirSync("build", { recursive: true });
  execFileSync("/usr/bin/iconutil", ["-c", "icns", set, "-o", "build/icon.icns"]);

  // Windows: ICO mit PNG-Einträgen (seit Windows Vista erlaubt), 16–256 px
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map(s => { const f = join(tmp, `ico-${s}.png`); resize(s, f); return readFileSync(f); });
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const o = 6 + 16 * i;
    head.writeUInt8(s >= 256 ? 0 : s, o); head.writeUInt8(s >= 256 ? 0 : s, o + 1);   // 0 = 256
    head.writeUInt8(0, o + 2); head.writeUInt8(0, o + 3);
    head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(pngs[i].length, o + 8); head.writeUInt32LE(offset, o + 12);
    offset += pngs[i].length;
  });
  writeFileSync("build/icon.ico", Buffer.concat([head, ...pngs]));
  console.log("build/icon.icns und build/icon.ico erzeugt.");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
