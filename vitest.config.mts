import { configDefaults, defineConfig } from "vitest/config";

// Wie VJ-Link. Der Kern hängt nicht von der Rechner-Zeitzone ab: Tests laufen mit TZ=UTC
// (ein Test schaltet zusätzlich auf America/New_York um, RECHERCHE §3 Testfall 13).
export default defineConfig({
  test: { include: ["tests/**/*.test.ts", "src/**/*.test.ts"], exclude: [...configDefaults.exclude, ".claude/**", "dist/**"], env: { TZ: "UTC" } },
});
