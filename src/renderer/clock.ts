// Fenster „Große Uhr“ am Leitstand (auf einen zweiten Bildschirm ziehbar). Keine Startanimation, sofort die Zeit.
// Gleiche Darstellung wie /uhr/<floor> im Browser (src/shared/clockview.ts).
import { ClockSync, FIRST_PROBES, FIRST_PROBE_GAP, REPEAT_EVERY, REPEAT_PROBES, msToNextSecond } from "../core/clock";
import { setLang, t } from "../core/i18n";
import type { WebPlan } from "../core/plan";
import type { CrewBridge } from "../shared/bridge";
import { renderClock } from "../shared/clockview";
import { applyTheme } from "../shared/ui";

const bridge = window.crew as CrewBridge;
const floor = new URLSearchParams(location.search).get("floor") ?? "";
const root = document.getElementById("app")!;
const sync = new ClockSync();
const dismissed = new Set<string>();
let plan: WebPlan | null = null;
const now = () => (sync.synced ? sync.now(performance.now()) : Date.now());

async function probe(): Promise<void> {
  const t1 = performance.now();
  const r = await bridge.clockPing().catch(() => null);
  if (r) sync.add(t1, r.r, r.s, performance.now(), Date.now());
}

function draw(): void {
  renderClock(root, plan, floor, now(), { source: t("top.house", { src: t("start.time.system") }), dismissed });
  const band = root.querySelector<HTMLElement>(".clock-band[data-notice]");
  if (band) band.addEventListener("click", () => { dismissed.add(band.dataset.notice!); draw(); });
}
function loop(): void { draw(); setTimeout(loop, msToNextSecond(now())); }

async function boot(): Promise<void> {
  const st = await bridge.getState();
  setLang(st.prefs.lang);
  applyTheme(st.prefs.theme);
  bridge.onState(s => { setLang(s.prefs.lang); applyTheme(s.prefs.theme); draw(); });
  plan = await bridge.getPlan();
  bridge.onPlan(p => { plan = p; draw(); });
  document.title = `Crew Link · ${plan?.floors.find(f => f.id === floor)?.name ?? ""}`;
  for (let i = 0; i < FIRST_PROBES; i++) { await probe(); await new Promise(r => setTimeout(r, FIRST_PROBE_GAP)); }
  setInterval(async () => { for (let i = 0; i < REPEAT_PROBES; i++) await probe(); }, REPEAT_EVERY);
  // Doppelklick: Vollbild
  root.addEventListener("dblclick", () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => {}); });
  loop();
}
void boot();
