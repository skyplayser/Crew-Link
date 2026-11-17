// Bildschirm wach halten im Browser – Herkunft: LJ Link src/main/resources/web/app.js, Abschnitt „Keep the screen awake
// (ADR-022)“ (wakeLockUsable, awakeVideo, playAwakeVideo, checkAwakeVideo, updateAwake, releaseAwake, onAwakeTap),
// gleicher Autor, EPL-2.0; 1:1 nach TypeScript übertragen, nur die Anzeige an Crew Link angepasst.
// Das Video (keep-awake-video.js, KEEP_AWAKE_MP4) ist unverändert aus LJ Link übernommen (selbst mit ffmpeg erzeugt,
// Idee von NoSleep.js, kein Code von dort).
// 1. Screen Wake Lock: nur im sicheren Kontext (https, localhost) – über http://<IP> auf Handys also meist nicht.
// 2. Sonst ein stilles Video mit Tonspur, das weiterläuft (WebKit hält den Bildschirm nur dafür an). Erst nach Berührung.
// 3. Ehrlicher Status: „aktiv (Video)“ erst, wenn currentTime wirklich läuft (Prüfung alle 3 s).

declare const KEEP_AWAKE_MP4: string | undefined;
interface WakeLockSentinelLike { released: boolean; release(): Promise<void>; addEventListener(t: "release", f: () => void): void }

export type AwakeState = "off" | "lock" | "starting" | "video" | "stalled" | "waiting" | "hidden" | "unavailable";

const awake = {
  lock: null as WakeLockSentinelLike | null, requesting: false, video: null as HTMLVideoElement | null, state: "off" as AwakeState, lockFailed: false,
  path: "none" as "none" | "lock" | "video", lastTime: -1, progressing: false, played: false, lastStop: null as { at: Date; why: string } | null,
  check: 0 as number, still: 0,
};
const AWAKE_CHECK_MS = 3000;
const AWAKE_START_CHECKS = 2;
let wanted = true;
let onChange: (s: AwakeState) => void = () => { /* gesetzt von web.ts */ };

export function awakeState(): AwakeState { return awake.state; }
export function awakeWanted(): boolean { return wanted; }

function wakeLockUsable(): boolean {
  return window.isSecureContext && "wakeLock" in navigator && !awake.lockFailed;
}

function setAwake(state: AwakeState): void {
  awake.state = state;
  if (state === "starting" || state === "video") startAwakeCheck(); else stopAwakeCheck();
  if (state === "lock") awake.path = "lock";
  if (state === "starting" || state === "video" || state === "stalled") awake.path = "video";
  onChange(state);
}

function awakeVideoStopped(why: string): void {
  awake.progressing = false;
  awake.lastStop = { at: new Date(), why };
  if (!wanted || awake.state === "off") return;
  if (document.visibilityState !== "visible") { setAwake("hidden"); return; }
  setAwake("stalled");
}

function checkAwakeVideo(): void {
  const v = awake.video;
  if (!v || !wanted || document.visibilityState !== "visible") return;
  if (awake.state !== "starting" && awake.state !== "video") return;
  const now = v.currentTime;
  const moved = awake.lastTime >= 0 && now !== awake.lastTime;
  awake.lastTime = now;
  if (v.paused || v.ended) { awakeVideoStopped(v.ended ? "ended" : "paused"); return; }
  if (moved) {
    awake.still = 0;
    awake.progressing = true;
    if (awake.state !== "video") setAwake("video"); else onChange(awake.state);
  } else if (awake.state === "video") {
    awakeVideoStopped("time not moving");
  } else if (++awake.still >= AWAKE_START_CHECKS) {
    awakeVideoStopped("time never started");
  }
}

function startAwakeCheck(): void { if (!awake.check) awake.check = window.setInterval(checkAwakeVideo, AWAKE_CHECK_MS); }
function stopAwakeCheck(): void { if (awake.check) { clearInterval(awake.check); awake.check = 0; } }
function restartAwakeCheck(): void { stopAwakeCheck(); awake.still = 0; awake.lastTime = awake.video ? awake.video.currentTime : -1; }

function awakeVideo(): HTMLVideoElement {
  if (awake.video) return awake.video;
  const v = document.createElement("video");
  v.setAttribute("playsinline", "");
  v.setAttribute("webkit-playsinline", "");
  v.setAttribute("aria-hidden", "true");
  v.setAttribute("tabindex", "-1");
  (v as HTMLVideoElement & { disablePictureInPicture: boolean }).disablePictureInPicture = true;
  v.preload = "auto";
  v.className = "keep-awake-video";
  v.src = KEEP_AWAKE_MP4!;
  // Von Hand im Kreis: WebKit lässt den Bildschirm bei loop oder beendetem Video schlafen.
  v.addEventListener("timeupdate", () => { if (v.duration && v.currentTime > v.duration - 1.5) v.currentTime = 0.5; });
  v.addEventListener("pause", () => { if (awake.state !== "off" && awake.state !== "stalled") awakeVideoStopped("pause event"); });
  v.addEventListener("ended", () => { if (awake.state === "video" || awake.state === "starting") awakeVideoStopped("ended event"); });
  document.body.appendChild(v);
  awake.video = v;
  return v;
}

function playAwakeVideo(fromTap: boolean): void {
  if (typeof KEEP_AWAKE_MP4 !== "string") { setAwake("unavailable"); return; }
  const v = awakeVideo();
  awake.path = "video";
  let p: Promise<void>;
  try { p = v.play(); } catch (e) { p = Promise.reject(e); }
  Promise.resolve(p).then(() => {
    if (!wanted) { v.pause(); return; }
    awake.played = true;
    awake.progressing = false;
    restartAwakeCheck();
    setAwake("starting");
  }).catch((e: { name?: string }) => {
    if (fromTap && !(e && e.name === "NotAllowedError")) setAwake("unavailable");
    else setAwake(awake.played ? "stalled" : "waiting");
  });
}

/** Bildschirm an halten: beim Start, beim Sichtbarwerden, nach Berührung und aus dem Menü. */
export function updateAwake(fromTap = false): void {
  if (!wanted) { releaseAwake(); setAwake("off"); return; }
  if (document.visibilityState !== "visible") { setAwake("hidden"); return; }
  if (wakeLockUsable()) {
    if (awake.lock && !awake.lock.released) { setAwake("lock"); return; }
    if (awake.requesting) return;
    awake.requesting = true;
    (navigator as Navigator & { wakeLock: { request(t: "screen"): Promise<WakeLockSentinelLike> } }).wakeLock.request("screen").then(lock => {
      awake.lock = lock;
      lock.addEventListener("release", () => {
        if (awake.lock === lock) awake.lock = null;
        if (!wanted) return;
        if (document.visibilityState === "visible") updateAwake(); else setAwake("hidden");
      });
      if (!wanted) { releaseAwake(); setAwake("off"); return; }
      setAwake("lock");
    }).catch(() => {
      if (fromTap) { awake.lockFailed = true; playAwakeVideo(true); } else setAwake("waiting");
    }).finally(() => { awake.requesting = false; });
    return;
  }
  awake.path = "video";
  if (awake.video && !awake.video.paused && !awake.video.ended && !fromTap) {
    if (awake.state !== "starting" && awake.state !== "video") { restartAwakeCheck(); setAwake(awake.progressing ? "video" : "starting"); }
    return;
  }
  playAwakeVideo(fromTap);
}

function releaseAwake(): void {
  if (awake.lock) { const lock = awake.lock; awake.lock = null; lock.release().catch(() => { /* schon frei */ }); }
  awake.progressing = false;
  stopAwakeCheck();
  if (awake.video) awake.video.pause();
}

function onAwakeTap(): void {
  if (wanted && (awake.state === "waiting" || awake.state === "stalled")) updateAwake(true);
}

export function setAwakeWanted(on: boolean): void { wanted = on; updateAwake(true); }

export function initAwake(cb: (s: AwakeState) => void): void {
  onChange = cb;
  document.addEventListener("click", onAwakeTap, true);
  document.addEventListener("touchend", onAwakeTap, true);
  document.addEventListener("keydown", onAwakeTap, true);
  document.addEventListener("visibilitychange", () => updateAwake());
  document.addEventListener("fullscreenchange", () => updateAwake());
  window.addEventListener("pageshow", e => { if (e.persisted) updateAwake(); });
  updateAwake();
}
