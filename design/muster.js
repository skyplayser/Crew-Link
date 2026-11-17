// Crew Link – Hilfen nur für die statischen Muster (design/muster-*.html).
// 1) ICONS: eigene Linien-Icons 24×24, stroke = currentColor (wie VD-Link src/ui/dom.ts:10-31).
//    Der Programmierer übernimmt die Tabelle nach src/shared/icons.ts und baut <svg> wie dom.ts:34-44.
// 2) QR: nur ein PLATZHALTER mit Suchmustern. Im Programm kommt ein echter QR-Code aus einer lokal
//    gebündelten Bibliothek (z. B. „qrcode-generator“, MIT) – nie aus dem Netz.
'use strict';

const ICONS = {
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z"/>',
  newEvent: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/>',
  template: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  open: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1"/><path d="M3 7v11a2 2 0 0 0 2 2h13l3-9H7l-4 9"/>',
  clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  net: '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v5M12 12l-6 5M12 12l6 5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  pause: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h0M4 12h0M4 18h0"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v0"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v0"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  wifiOff: '<path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 4.2-2.6M19 12.9a10 10 0 0 0-2.4-1.7M2 9a15 15 0 0 1 4.5-2.8M22 9a15 15 0 0 0-11-4"/><circle cx="12" cy="20" r=".8"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  // Rollen
  lead: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/><path d="M17 4l2-1M19 7h2"/>',
  booth: '<rect x="3" y="11" width="18" height="9" rx="1.5"/><path d="M7 11V8M12 11V5M17 11V8"/><circle cx="7" cy="15.5" r="1"/><circle cx="12" cy="15.5" r="1"/><circle cx="17" cy="15.5" r="1"/>',
  dj: '<circle cx="8.5" cy="13" r="5.5"/><circle cx="8.5" cy="13" r="1.4"/><path d="M15.5 6h5v12h-5z"/><path d="M18 9v4"/>',
  tech: '<path d="M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5L16 12l-4-4z"/>',
  security: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
  bar: '<path d="M6 3h12l-1.5 8a4.5 4.5 0 0 1-9 0z"/><path d="M12 15.5V21M8.5 21h7"/>',
  public: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
};

function svgIcon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}

function qrPlaceholder(text, n = 25) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) & 1023) / 1024;
  const cells = [];
  const finder = (x, y) => { for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
    const edge = i === 0 || j === 0 || i === 6 || j === 6, core = i >= 2 && i <= 4 && j >= 2 && j <= 4;
    if (edge || core) cells.push([x + i, y + j]); } };
  const inFinder = (x, y) => (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
  finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) if (!inFinder(x, y) && rnd() < 0.48) cells.push([x, y]);
  return `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" aria-hidden="true"><path fill="#000" d="${cells.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join('')}"/></svg>`;
}

document.querySelectorAll('[data-icon]').forEach((el) => { el.insertAdjacentHTML('afterbegin', svgIcon(el.dataset.icon)); });
document.querySelectorAll('.qr[data-qr]').forEach((el) => { el.innerHTML = qrPlaceholder(el.dataset.qr); el.setAttribute('role', 'img'); el.setAttribute('aria-label', 'QR ' + el.dataset.qr); });
