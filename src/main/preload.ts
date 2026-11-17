// Preload: schmale Brücke (nur benannte Funktionen), contextIsolation + sandbox.
import { contextBridge, ipcRenderer } from "electron";
import type { CrewBridge } from "../shared/bridge";

const bridge: CrewBridge = {
  getState: () => ipcRenderer.invoke("state:get"),
  introTake: () => ipcRenderer.invoke("intro:take"),
  onState: cb => { ipcRenderer.on("state", (_e, s) => cb(s)); },
  setEvent: (ev, changed) => ipcRenderer.invoke("event:set", ev, changed ?? []),
  demo: () => ipcRenderer.invoke("event:demo"),
  fileOpen: () => ipcRenderer.invoke("file:open"),
  fileSave: as => ipcRenderer.invoke("file:save", as === true),
  templateSave: t => ipcRenderer.invoke("template:save", t),
  templateOpen: () => ipcRenderer.invoke("template:open"),
  setWeb: (on, port) => ipcRenderer.invoke("web:set", on === true, port),
  webAskDone: () => { ipcRenderer.send("web:askDone"); },
  setPrefs: p => ipcRenderer.invoke("prefs:set", p),
  setPrivacy: on => { ipcRenderer.send("privacy:set", on === true); },
  clockPing: () => ipcRenderer.invoke("clock:ping"),
  clockAnswer: accept => { ipcRenderer.send("clock:answer", accept === true); },
  openClock: floor => { ipcRenderer.send("clock:open", floor); },
  openNetLink: () => { ipcRenderer.send("netlink:open"); },
  chatGet: since => ipcRenderer.invoke("chat:get", since),
  chatPost: (text, urgent) => ipcRenderer.invoke("chat:post", text, urgent === true),
  chatProfile: (nick, where) => ipcRenderer.invoke("chat:profile", nick, where),
  chatAttention: () => { ipcRenderer.send("chat:attention"); },
  onChat: cb => { ipcRenderer.on("chat", () => cb()); },
  onPlan: cb => { ipcRenderer.on("plan", (_e, p) => cb(p)); },
  getPlan: () => ipcRenderer.invoke("plan:get"),
  onMenu: cb => { ipcRenderer.on("menu", (_e, cmd) => { if (typeof cmd === "string") cb(cmd); }); },
  suiteLauncher: () => ipcRenderer.invoke("suite:launcher"),
  openLauncherPage: () => { ipcRenderer.send("suite:launcher-page"); },
  onSuiteLauncher: cb => { ipcRenderer.on("suite:launcher", (_e, l) => cb(l)); },
  platform: process.platform,
};
contextBridge.exposeInMainWorld("crew", bridge);
