// Hinweis-Texte (Banner, Hinweis-Leiste, Streifen der großen Uhr) aus den Hinweisen des Kerns.
import { t } from "../core/i18n";
import type { Notice, WebPlan } from "../core/plan";
import { fmtCountdown } from "../core/countdown";
import { localHM } from "../core/zeit";

/** [Kopf, Zusatz] eines Hinweises. */
export function noticeText(n: Notice, plan: Pick<WebPlan, "tz" | "days">, now = Date.now()): [string, string] {
  const p: Record<string, string | number> = { ...n.p, time: localHM(n.at, plan.tz) };
  // Überzogen: echter Wert seit dem geplanten Ende, nicht die Schwelle
  if (n.kind === "over" && typeof n.p.end === "number") p.over = fmtCountdown(n.p.end - now);
  if (typeof n.p.start === "number") p.start = localHM(n.p.start, plan.tz);
  if (typeof n.p.end === "number") p.end = localHM(n.p.end, plan.tz);
  // Ende der Musik für die Sperrstunden-Folge
  if (n.kind === "entryStop" || n.kind === "lastRound" || n.kind === "curfew-warn" || n.kind === "curfew-last") {
    const day = plan.days.find(d => d.curfew !== null && d.curfew >= n.at && d.start <= n.at);
    if (day?.curfew) p.curfew = localHM(day.curfew, plan.tz);
  }
  return [t(`notice.${n.kind}`, p), t(`notice.${n.kind}.sub`, p)];
}
