// Alle Texte über i18n: jeder im Quelltext benutzte Schlüssel ist in DE und EN da.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DE } from "../src/core/i18n-de";
import { EN } from "../src/core/i18n-en";
import { setLang, t } from "../src/core/i18n";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : []; });
}

describe("i18n", () => {
  it("jeder feste Schlüssel aus t(\"…\") existiert in DE und EN", () => {
    const missing: string[] = [];
    for (const f of files("src")) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\bt\(\s*"([a-zA-Z0-9_.-]+)"/g)) if (!(m[1]! in DE) || !(m[1]! in EN)) missing.push(`${f}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });
  it("zusammengesetzte Schlüssel (Prüfung, Hinweise, Rollen, Arten, Tabs) gibt es alle", () => {
    const need = [
      ...["overlap", "gap", "afterCurfew", "afterFloorEnd", "outside", "floorClosed", "dayOverlap"].flatMap(k => [`check.${k}`, `check.${k}.sub`]),
      ...["prep30", "next10", "setEnd5", "handover", "over", "changeover", "entryStop", "lastRound", "curfew-warn", "curfew-last", "curfew", "floor-warn", "floor-last", "floor-end", "changed"].flatMap(k => [`notice.${k}`, `notice.${k}.sub`]),
      ...["lead", "booth", "dj", "tech", "security", "bar"].flatMap(r => [`role.${r}`, `role.${r}.sub`]),
      ...["dj", "live", "b2b", "changeover", "break"].map(k => `slot.kind.${k}`),
      ...["now", "timetable", "clock", "roles", "signals", "connect"].map(k => `tab.${k}`),
      ...["off", "lock", "starting", "video", "stalled", "waiting", "hidden", "unavailable"].map(k => `web.awake.${k}`),
      ...["day", "qr", "lead"].map(k => `print.${k}`), ...["c1", "c2", "c3", "c4", "c5"].map(k => `color.${k}`),
      ...["date", "label", "start", "end", "curfew"].map(k => `new.days.${k}`), ...["name", "public", "note", "start", "end"].map(k => `slot.${k}`),
    ];
    expect(need.filter(k => !(k in DE) || !(k in EN))).toEqual([]);
  });
  it("Platzhalter werden ersetzt, Sprache umschaltbar", () => {
    setLang("en");
    expect(t("days.next", { day: "Sat 11/15", time: "12:00", t: "7:42:10" })).toBe("Next day: Sat 11/15 12:00 · in 7:42:10");
    setLang("de");
    expect(t("cd.left", { t: "2:13:12" })).toBe("noch 2:13:12");
  });
});
